const worker = new Worker(new URL("../worker/worker.js", import.meta.url), {
  type: "module",
  name: "my-worker",
});
worker.postMessage("hello");
