// no types @surma!? :-(
declare module "@surma/rollup-plugin-off-main-thread" {
  const omt: Function;
  export default omt;
}

declare module "tippex" {
  export type MatchArgs = [
    fullMatch: string,
    ...matches: string[],
    index: number,
    content: string
  ];
  export function match(
    input: string,
    regexp: RegExp,
    cb: (...args: MatchArgs) => void
  ): void;
}
