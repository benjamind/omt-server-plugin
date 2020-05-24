const omtPlugin = require("../dist/index.js");

module.exports = {
  port: 8080,
  watch: true,
  nodeResolve: {
    browser: true,
  },
  preserveSymlinks: true,
  plugins: [omtPlugin()],
};
