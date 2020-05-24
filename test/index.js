const worker = new Worker("./worker.js", { type: "module", name: "my-worker" });

worker.postMessage("hello");
