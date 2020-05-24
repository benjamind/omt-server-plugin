"use strict";
const tslib_1 = require("tslib");
const rollup_1 = require("rollup");
const rollup_plugin_sourcemaps_1 = tslib_1.__importDefault(require("rollup-plugin-sourcemaps"));
const plugin_node_resolve_1 = tslib_1.__importDefault(require("@rollup/plugin-node-resolve"));
const rollup_plugin_off_main_thread_1 = tslib_1.__importDefault(require("@surma/rollup-plugin-off-main-thread"));
const path_1 = tslib_1.__importDefault(require("path"));
const magic_string_1 = tslib_1.__importDefault(require("magic-string"));
function isChromiumBased(userAgent) {
    const agent = userAgent.toLowerCase();
    return (agent.indexOf("edg/") > -1 ||
        agent.indexOf("chrome") > -1 ||
        agent.indexOf("chromium") > -1);
}
function omtPlugin(config) {
    const workerRegexp = /new Worker\((["'])(.+?)\1(,[^)]+)?\)/g;
    const workerEntrypoints = new Map();
    const virtualFiles = new Map();
    let watcher;
    return {
        serverStart({ fileWatcher }) {
            watcher = fileWatcher;
        },
        async serve(context) {
            if (isChromiumBased(context.request.headers["user-agent"])) {
                return; // do nothing on chromium based browsers
            }
            const requestedUrl = context.path;
            // serve sourcemaps from memory
            if (requestedUrl.endsWith(".map")) {
                // if requested map is in the virtual files map just return it
                if (virtualFiles.has(requestedUrl)) {
                    return { body: virtualFiles.get(requestedUrl) };
                }
            }
            // if its not a worker entry point just exit
            if (!workerEntrypoints.has(requestedUrl)) {
                return;
            }
            // otherwise serve the bundled worker
            const worker = workerEntrypoints.get(requestedUrl);
            // if we already have the worker code, serve it
            if (worker.code) {
                return { body: worker.code };
            }
            // process the worker file
            console.log(`omt-worker-plugin: bundling worker from '${worker.url}'`);
            const legacyBundle = await rollup_1.rollup({
                input: worker.url,
                plugins: [
                    rollup_plugin_sourcemaps_1.default(),
                    plugin_node_resolve_1.default({
                        browser: true,
                        rootDir: worker.rootDir,
                    }),
                    rollup_plugin_off_main_thread_1.default(),
                ],
            });
            // if we've already watched this bundle before, unwatch first to avoid duplicates
            if (worker.watchListener) {
                watcher.removeListener("change", worker.watchListener);
                watcher.unwatch(worker.watchedFiles);
            }
            // add the watch files from the bundle to the watcher
            watcher.add(legacyBundle.watchFiles);
            worker.watchedFiles = legacyBundle.watchFiles;
            // add a listener to clear the bundle when we detect change in the worker dependencies
            const watchListener = (path) => {
                if (legacyBundle.watchFiles.includes(path) && worker.code) {
                    console.log(`omt-worker-plugin: worker bundle at '${worker.url}' changed, rebundling.`);
                    worker.code = undefined;
                }
            };
            watcher.addListener("change", watchListener);
            worker.watchListener = watchListener;
            // generate the worker using AMD
            const { output } = await legacyBundle.generate({
                format: "amd",
                sourcemap: true,
            });
            worker.code = output[0].code;
            // you have to append your own sourcemapping comment when using generate
            worker.code += `//# sourceMappingURL=${path_1.default.posix.basename(requestedUrl)}.map`;
            // add the sourcemap to virtual files list to be served directly later
            virtualFiles.set(`${requestedUrl}.map`, output[0].map);
            // return the worker code
            return { body: worker.code };
        },
        transform(context) {
            if (context.response.is("js")) {
                const code = context.body;
                let ms;
                let hasWorker = false;
                while (true) {
                    const match = workerRegexp.exec(code);
                    if (!match) {
                        break;
                    }
                    const workerURL = match[2];
                    const workerRootDir = path_1.default.posix.dirname(context.path).slice(1);
                    const resolvedWorkerPath = `/${path_1.default.posix.normalize(path_1.default.posix.join(workerRootDir, workerURL))}`;
                    let optionsObject = {};
                    // Parse the optional options object
                    if (match[3] && match[3].length > 0) {
                        // I scratched my head at this initially, this is due to JSON in JS files not actually being valid JSON
                        // strings due to lack of proper quoting, this is an interesting work around @surma!
                        // FIXME: ooooof!
                        optionsObject = new Function(`return ${match[3].slice(1)};`)();
                    }
                    if (optionsObject.type !== "module") {
                        // don't need to bundle non-module workers so exit
                        return;
                    }
                    hasWorker = true;
                    let workerEntry = {
                        code: undefined,
                        url: workerURL,
                        rootDir: workerRootDir,
                        options: optionsObject,
                        watchListener: undefined,
                        watchedFiles: [],
                    };
                    workerEntrypoints.set(resolvedWorkerPath, workerEntry);
                    // also borrowed from OMT plugin, have to rewrite the worker string to the new path
                    const workerParametersStartIndex = match.index + "new Worker(".length;
                    const workerParametersEndIndex = match.index + match[0].length - ")".length;
                    ms = new magic_string_1.default(code);
                    ms.overwrite(workerParametersStartIndex, workerParametersEndIndex, `'${resolvedWorkerPath}', ${JSON.stringify(optionsObject)}`);
                }
                // if the file has worker references, we've modified it
                // so we should generate a new sourcemap and add it to the virtuals list
                if (hasWorker && ms) {
                    const sourcemap = ms.generateMap({
                        hires: true,
                    });
                    virtualFiles.set(`${context.path}.map`, sourcemap);
                    return { body: ms.toString() };
                }
            }
        },
    };
}
module.exports = omtPlugin;
//# sourceMappingURL=index.js.map