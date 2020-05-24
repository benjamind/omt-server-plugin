# omt-server-plugin

A plugin for [es-dev-server](https://github.com/open-wc/open-wc/tree/master/packages/es-dev-server) to bundle webworkers when using `new Worker('my-worker.js', { type="module" });` on browsers which do not currently support it.

Using ESM in workers is part of the spec, unfortunately its only currently implemented in Chromium based browsers. This plugin adds additional logic to `es-dev-server` to automatically run rollup over worker imports where the worker is imported with ESM enabled. Browsers which do not support ESM in workers will then be served the bundled worker while leaving spec compliant browsers using a true module system.

This plugin uses [rollup](https://rollupjs.org/) and Surmas [rollup-plugin-off-main-thread](https://github.com/surma/rollup-plugin-off-main-thread) to bundle the worker files on demand.

## Usage

Add the plugin to your `es-dev-server.js` config file or at the commandline:

```js
const omtPlugin = require("omt-server-plugin");

module.exports = {
  nodeResolve: {
    browser: true,
  },
  plugins: [omtPlugin()],
};
```

Thats it! The plugin will now detect all instances of the constructor `new Worker()` in your served modules and
automatically bundle the worker entrypoint and serve it to non-Chromium based browsers.
