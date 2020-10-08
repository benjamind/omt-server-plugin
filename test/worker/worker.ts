import { foo } from "./worker-dep.js";

console.log("worker loaded!");
const localPath = import.meta.url;
console.log("local path", localPath);

self.addEventListener("message", (ev) => {
  console.log(ev);
  foo();
});
