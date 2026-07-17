const baseConfig = require('./tailwind.config.cjs');

/**
 * Wiki 路由只扫描 src/styles/wiki.css 中显式声明的来源，避免重复生成主站与后台工具类。
 */
module.exports = {
  ...baseConfig,
  content: [],
};
