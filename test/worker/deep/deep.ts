export function foo() {
  const localPath = import.meta.url;
  console.log("local path in deep/deep.ts", localPath);
}
