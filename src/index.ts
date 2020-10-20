import { Plugin } from "@web/dev-server-core";
import { rollup } from "rollup";
import { FSWatcher } from "chokidar";
import sourcemaps from "rollup-plugin-sourcemaps";
import nodeResolve from "@rollup/plugin-node-resolve";
import OMT from "@surma/rollup-plugin-off-main-thread";
import path from "path";
import MagicString from "magic-string";
import { SourceMapConsumer, SourceMapGenerator } from "source-map";
import { readFileSync, existsSync } from "fs";

interface OMTConfig {}

function isChromiumBased(userAgent: string): boolean {
  const agent = userAgent.toLowerCase();
  return (
    agent.indexOf("edg/") > -1 ||
    agent.indexOf("chrome") > -1 ||
    agent.indexOf("chromium") > -1
  );
}

function omtPlugin(config: OMTConfig): Plugin {
  const workerRegexp = /new Worker\((["'])(.+?)\1(,[^)]+)?\)/g;
  const workerEntrypoints = new Map();
  const virtualFiles = new Map();
  let watcher: FSWatcher;
  let rootDir: string;

  return {
    name: "omt-server-plugin",

    serverStart({ config, fileWatcher }) {
      watcher = fileWatcher;
      rootDir = config.rootDir;
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
      console.log(
        `omt-worker-plugin: bundling worker from '${worker.url}': ${rootDir} ${worker.rootDir}`
      );

      const legacyBundle = await rollup({
        input: worker.url,
        plugins: [
          sourcemaps(),
          nodeResolve({
            browser: true,
            rootDir: path.resolve(rootDir, worker.rootDir),
          }),
          {
            resolveImportMeta(property, { moduleId }) {
              if (property === "url") {
                return `new URL('/${path.relative(
                  rootDir,
                  moduleId
                )}', location.origin).href`;
              }
              return null;
            },
          },
          OMT(),
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
      const watchListener = (path: string) => {
        if (legacyBundle.watchFiles.includes(path) && worker.code) {
          console.log(
            `omt-worker-plugin: worker bundle at '${worker.url}' changed, rebundling.`
          );
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
      worker.code += `//# sourceMappingURL=${path.posix.basename(
        requestedUrl
      )}.map`;

      // add the sourcemap to virtual files list to be served directly later
      virtualFiles.set(`${requestedUrl}.map`, output[0].map);

      // return the worker code
      return { body: worker.code };
    },

    transformCacheKey(context) {
      if (isChromiumBased(context.request.headers["user-agent"])) {
        return undefined; // do nothing on chromium based browsers
      }
      // do nothing if its not a worker entrypoint
      if (!workerEntrypoints.has(context.path)) {
        return undefined;
      }
      // otherwise add legacy as the cache key to avoid caching issues
      return "legacy";
    },

    async transform(context) {
      if (context.path && context.path.endsWith(".js")) {
        const code = context.body;
        let ms: MagicString | undefined;

        let hasWorker = false;
        while (true) {
          const match = workerRegexp.exec(code);
          if (!match) {
            break;
          }

          const workerURL = match[2];
          const workerRootDir = path.posix.dirname(context.path).slice(1);

          const resolvedWorkerPath = `/${path.posix.normalize(
            path.posix.join(workerRootDir, workerURL)
          )}`;

          let optionsObject: {
            type?: "module" | "classic";
            name?: string;
            credentials?: string;
          } = {};

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
          const workerParametersEndIndex =
            match.index + match[0].length - ")".length;
          ms = new MagicString(code);
          ms.overwrite(
            workerParametersStartIndex,
            workerParametersEndIndex,
            `'${resolvedWorkerPath}', ${JSON.stringify(optionsObject)}`
          );
        }

        // if the file has worker references, we've modified it
        // so we should generate a new sourcemap and add it to the virtuals list
        if (hasWorker && ms) {
          const convertedBody = ms.toString();
          // parse the content for the sourcemap comment
          const sourceMapCommentRegexp = /\/\/# sourceMappingURL=(\S*)/g;
          const matches = code.match(sourceMapCommentRegexp);
          const baseDir = path.posix.join(
            rootDir,
            path.posix.dirname(context.path)
          );
          if (matches && matches.length > 0) {
            // if we have a sourcemap comment and it actually exists
            const lastComment = matches[matches?.length - 1];
            const ogSourcemapPath = lastComment.split("=")[1];
            const ogSourcemapPathResolved = path.posix.resolve(
              baseDir,
              ogSourcemapPath
            );
            if (existsSync(ogSourcemapPathResolved)) {
              // render our sourcemap using magic-string
              // this maps from the transformed file to the requested file
              const sourcemap = ms.generateMap({
                hires: true,
                file: `${context.path}.map`,
                source: context.path,
              });
              // now load the original sourcemap, this maps from the requested file to the original source
              const ogSourcemapContent = readFileSync(ogSourcemapPathResolved, {
                encoding: "utf8",
              });
              const parsedSourcemap = JSON.parse(ogSourcemapContent);
              const generatedSourcemap = await SourceMapConsumer.with(
                parsedSourcemap,
                null,
                async function (consumer) {
                  const generator = SourceMapGenerator.fromSourceMap(consumer);
                  return await SourceMapConsumer.with(
                    sourcemap,
                    null,
                    (consumer2) => {
                      // apply the transformed sourcemap to the original sourcemap
                      // the resultant generated sourcemap should in theory map us from the transformed file
                      // all the way back to the original source file.
                      generator.applySourceMap(
                        consumer2,
                        `${context.path}`,
                        `${context.path}.map`
                      );
                      return generator.toString();
                    }
                  );
                }
              );
              virtualFiles.set(`${ogSourcemapPath}`, generatedSourcemap);
            }
          }
          return { body: convertedBody };
        }
      }
    },
  };
}

export default omtPlugin;
