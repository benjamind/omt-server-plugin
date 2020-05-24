import { foo } from "./worker-dep.js";

console.log("worker loaded!");

self.addEventListener("message", (ev) => {
  console.log(ev);
  foo();
});
