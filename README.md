# omt-server-plugin

A plugin for [@web/dev-server](https://modern-web.dev/docs/dev-server/overview/) to bundle webworkers when using `new Worker('my-worker.js', { type="module" });` on browsers which do not currently support it.

Using ESM in workers is part of the spec, unfortunately its only currently implemented in Chromium based browsers. This plugin adds additional logic to `@web/dev-server` to automatically run rollup over worker imports where the worker is imported with ESM enabled. Browsers which do not support ESM in workers will then be served the bundled worker while leaving spec compliant browsers using a true module system.

This plugin uses [rollup](https://rollupjs.org/) and Surmas [rollup-plugin-off-main-thread](https://github.com/surma/rollup-plugin-off-main-thread) to bundle the worker files on demand.

## Usage

Add the plugin to your `web-dev-server.config.mjs` config file or at the commandline:

```js
import omtPlugin from "omt-server-plugin";

export default {
  port: 8080,
  nodeResolve: {
    browser: true,
  },
  plugins: [omtPlugin()],
};
```

Thats it! The plugin will now detect all instances of the constructor `new Worker()` in your served modules and
automatically bundle the worker entrypoint and serve it to non-Chromium based browsers.

## Supported Worker constructors

The following worker constructor forms should be supported:

- `new Worker(import.meta.url, {type: 'module'})` - used where a worker is [self instantiating](https://github.com/surma/rollup-plugin-off-main-thread/blob/master/tests/fixtures/import-meta-worker/a.js)
- `new Worker('./worker.js', {type: 'module'})` - a module worker created using a relative path
- `new Worker(new URL('./worker.js', import.meta.url), {type: 'module'})` - a module worker created using a url resolved to the local module path (preferred)
