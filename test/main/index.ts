const worker = new Worker("../worker/worker.js", { type: "module", name: "my-worker" });
worker.postMessage("hello");