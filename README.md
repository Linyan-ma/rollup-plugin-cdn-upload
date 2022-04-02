# rollup-plugin-cdn-upload

A Rollup plugin which parsing local assets,upload it to cdn and replace the source\[html | chunks\],also support Vite

## Install

```js
npm install rollup-plugin-cdn-upload --save-dev
```

## Usage

```js
import uploadCdn from "rollup-plugin-cdn-upload";

export default {
  input: "src/index.js",
  output: {
    dir: "output",
    format: "cjs",
  },
  plugins: [
    uploadCdn({
      uploader: (content, ext) => {
        return Promise.resolve("CDN_UPLOADER_PH");
      },
    }),
  ],
};
```

for vite,base must set '' (default is /)

```js
export default defineConfig({
  base: "",
  build: {
    rollupOptions: {
      plugins: [
        uploadCdn({
          uploader: (content, ext) => {
            return Promise.resolve("CDN_UPLOADER_PH");
          },
        }),
      ],
    },
  },
});
```

## Options

### `uploader`

- **Type:** `function(content,ext):<Promise>`
- **Default:**
  ```js
  (content: sourceCode, ext: type) => {
    return Promise.resolve("CDN_UPLOADER_PH");
  };
  ```
  your cdn upload function with current upload source code and type ext. the funtion return a Promise with final url resolved

### `keepSource`

- **Type:** `boolean`
- **Default:** `false`

keep uploaded modules or not

### `cacheDir`

- **Type:** `string`
- **Default:** `./dist_cdn`

the response url will cached in this directory

### `output`

- **Type:** `string`
- **Default:** `./dist_cdn`

final html directory

```

```
