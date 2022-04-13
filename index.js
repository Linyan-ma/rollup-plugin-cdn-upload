const fse = require("fs-extra");
const { parse } = require("url");
const { extname, basename } = require("path");

const MagicString = require("magic-string").default;

function group(arr, pred) {
  const positives = [];
  const negatives = [];

  for (let item of arr) {
    if (pred(item)) {
      positives.push(item);
    } else {
      negatives.push(item);
    }
  }

  return [positives, negatives];
}
const defaultOpts = {
  keepSource: false, // replaced modules source write to output
  cacheDir: "./dist_cdn",
  output: "./dist_cdn",
  uploader: (content, ext) => {
    return Promise.resolve("");
  },
};
function cdnUploadPlugin(options) {
  let uploadedChunkMap = new Map();
  let assetsList;
  const opts = { ...defaultOpts, ...options };
  const cacheLocalDir = `${opts.cacheDir}/.cdn_cache`;

  const reIgnorePath = /^(?:(https?:)?\/\/)|(?:data:)/;
  const upload = async (content, name) => {
    // 文件名作为key
    const originName = name;
    name = basename(name);
    const ext = extname(name);
    // memory cache
    if (uploadedChunkMap.get(name)) {
      return Promise.resolve(uploadedChunkMap.get(name));
    }
    return new Promise((resolve, reject) => {
      opts
        .uploader(content, ext)
        .then((url) => {
          uploadedChunkMap.set(name, url);
          if (opts.keepSource) {
            fse.outputFileSync(`${opts.output}/${originName}`, content);
          }
          resolve(url);
        })
        .catch((e) => {
          reject(
            `[rollup-plugin-upload-cdn]:CDN_UPLOAD_ERROR: a error occur in upload :${e},please check your cdn uploader`
          );
        });
    });
  };
  const replaceCssAssets = async (cssAssets) => {
    const re = /url\((?!['"]?(?:data:|https?:|\/\/))(['"]?)([^'")]*)\1\)/g;
    for (let file of cssAssets) {
      let content = file.source;
      content = content.replace(re, (match, _, media) => {
        if (reIgnorePath.test(media)) return match;
        const uploadedUrl = uploadedChunkMap.get(basename(media));
        return match.replace(media, uploadedUrl);
      });
      await upload(content, file.fileName);
    }
  };
  const findByName = (name, bundles) => {
    return bundles.filter((v) => v.fileName === name)[0];
  };
  const getBundleAst = (_bundle) => {
    // entry may have multi
    const entryChunks = _bundle.filter(
      (output) => output.type === "chunk" && output.isEntry
    );
    const output = [];
    for (const entryChunk of entryChunks) {
      const ast = entryChunk;
      (function walk(chunk) {
        let deps = [...chunk.dynamicImports, ...chunk.imports].map((name) =>
          findByName(name, _bundle)
        );
        chunk.children = deps;
        for (const chunk of deps) {
          walk(chunk);
        }
      })(entryChunk);
      output.push(ast);
    }
    return output;
  };
  const replaceCssAssetsLegacy = (content) => {
    const re = /url\((?!['"]?(?:data:|https?:|\/\/))(['"]?)([^'")]*)\1\)/g;
    content = content.replace(re, (match, _, media) => {
      if (reIgnorePath.test(media)) return match;
      const uploadedUrl = uploadedChunkMap.get(basename(media));
      return match.replace(media, uploadedUrl);
    });
    return content;
  };
  const replaceChunks = async (chunkDeps) => {
    const currentCall = async (curChunk) => {
      const dynamicImports = curChunk.dynamicImports.map((fileName) =>
        basename(fileName)
      );
      const imports = curChunk.imports.map((fileName) => basename(fileName));
      let replaceList = [...assetsList, ...dynamicImports, ...imports];
      let content = curChunk.code;
      for (const name of replaceList) {
        const reg = new RegExp(`\\.?\/?((([a-z]{1,})\/){1,})?${name}`, "g");
        let url = uploadedChunkMap.get(name);
        if (!url) {
          console.error(
            `the plugin error: in replace ${curChunk.fileName},${name} has no uploaded url`
          );
        }
        // bug:plugin-legacy把css写入到legacy.js文件中，文件中css url()的路径未被修改
        content = content.replace(reg, url);
      }
      const childrenName = chunkDeps.children.map((v) => v.fileName);
      // console.log(`${curChunk.fileName} has upload to cdn,triggered by ${JSON.stringify(childrenName)}`)
      await upload(content, curChunk.fileName);
    };
    if (chunkDeps.children?.length) {
      let uploadPromises = chunkDeps.children.map((chunk) =>
        replaceChunks(chunk)
      );
      await Promise.all(uploadPromises);
      await currentCall(chunkDeps);
    } else {
      await upload(chunkDeps.code, chunkDeps.fileName);
    }
    // _uploadDepsToCdn(chunkDeps)
  };
  const replaceHtml = (html, bundles) => {
    const reImport =
      /(?:<(?:link|script|img)[^>]+(?:src|href)\s*=\s*)(['"]?)([^'"\s>]+)\1/g;
    let content = html.source;
    html.source = content.replace(reImport, (match, _, path) => {
      if (reIgnorePath.test(path)) return match;
      const url = uploadedChunkMap.get(basename(path));
      if (!url) {
        console.error(
          `${html.fileName} has a module [${path}] not upload,please upload by manual`
        );
      }
      return url ? match.replace(path, url) : match;
    });
    return html;
  };
  return {
    name: "rollup-plugin-upload-cdn",
    async buildStart(options) {
      // local cache
      const local_cache_exist = await fse.pathExists(cacheLocalDir);
      if (local_cache_exist) {
        let localCache = fse.readFileSync(cacheLocalDir);
        localCache = localCache ? JSON.parse(localCache) : false;
        if (localCache) {
          const localMap = new Map(Object.entries(localCache));
          uploadedChunkMap = new Map([...uploadedChunkMap, ...localMap]);
        }
      }
    },
    async writeBundle(options, bundle) {
      // staticAssets => css => js(entry) => html
      let bundles = Object.values(bundle);
      const assets = bundles.filter((output) => output.type === "asset");
      const chunks = bundles.filter((output) => output.type === "chunk");
      const [cssOrHtml, staticAssets] = group(assets, (asset) =>
        /\.(css|html)$/.test(asset.fileName)
      );
      const [cssAssets, htmlAssets] = group(cssOrHtml, (asset) =>
        asset.fileName.endsWith(".css")
      );

      assetsList = assets
        .filter((output) => !output.fileName.endsWith(".html"))
        .map((output) => basename(output.fileName));
      try {
        // staticAssets upload
        await Promise.all(
          staticAssets.map((asset) => upload(asset.source, asset.fileName))
        );
        // replace css url
        await replaceCssAssets(cssAssets);
        // replace chunks url
        const chunkDeps_array = getBundleAst(chunks);
        for (const chunkDeps of chunkDeps_array) {
          await replaceChunks(chunkDeps);
        }
        // const dist = options.dir
        // replace html url
        const html_cdn = htmlAssets.map((html) => replaceHtml(html, bundle));
        for (const html of html_cdn) {
          let fileName = html.fileName;
          // fileName = fileName.replace(/(.+)\.(.+)/, '$1-cdn.$2')
          fse.outputFileSync(`${opts.output}/${fileName}`, html.source);
        }
      } catch (e) {
        console.error("error:", e);
      }
    },
    closeBundle() {
      // cache to local
      if (uploadedChunkMap.size) {
        fse.outputFileSync(
          cacheLocalDir,
          JSON.stringify(Object.fromEntries(uploadedChunkMap.entries()))
        );
      }
    },
  };
}

module.exports = cdnUploadPlugin;
