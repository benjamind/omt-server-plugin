import { foo as deepFoo } from "./deep/deep.js";

export function foo() {
  console.log("foo bas");
  deepFoo();
}

const localPath = import.meta.url;
console.log("local path in worker-dep.ts", localPath);
