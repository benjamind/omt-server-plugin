import omtPlugin from "../esm/index.js";

export default {
  port: 8080,
  watch: true,
  nodeResolve: {
    browser: true,
  },
  preserveSymlinks: true,
  plugins: [omtPlugin()],
};
