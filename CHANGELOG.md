## [Unreleased]

### Added
- 新增 Lighthouse 性能预算脚本 `npm run perf:budget`（Mobile + Desktop，覆盖主要路由）
- 新增 Lighthouse 配置（`lighthouserc.mobile.cjs`、`lighthouserc.desktop.cjs`）与预算校验脚本（`scripts/perf-budget.mjs` 等）
- 强制 Markdown 链接在新标签页打开，避免当前页跳转
- 模态框支持通过 `panelClassName` 自定义宽度
- 新增“帖子搜索”页面：仅按正文关键字搜索，支持分页，并在移动端菜单栏提供入口
- 首页横幅文案与样式优化：提示双域名并推荐使用 https://jx3gua.com/ 加速访问
- 后台投稿新增“携带开发者信息”开关（默认开启并记住上次选择），帖子内以开发者名片展示 `admin`
- 新增“连续登录 7 天”彩纸礼花彩蛋（按指纹识别，仅在首页触发一次）

### Changed
- 关键页面改为懒加载，并延迟后台轮询/任务，降低首屏 JS 压力
- 启用服务端响应压缩，并在生产环境提供 dist 静态资源以便本地预览与 Lighthouse 测量
- Vite 分包策略调整（拆分 react-vendor、recharts），减少首屏阻塞
- 图标改用 `lucide-react`，移除 Material Symbols 字体依赖
- 举报详情弹窗加宽，并对长指纹/标识使用更友好的断词换行

### Fixed
- 修复指纹白名单遗漏关键接口导致指纹封禁失效的回归风险
- 修复 Windows 下 Vite 分包路径归一化不生效的问题
- 修复 Express 错误处理中间件顺序导致部分错误绕过自定义处理的问题
- 优化请求指纹：仅在需要的接口附带指纹，减少无意义的首屏计算
- 修复首页吉祥物首次渲染导致的 CLS 抖动（延迟渲染）
- 修复分享链接 `/post/:id` 在生产环境被静态服务当作目录导致的 EISDIR（Caddy 将 `/post/*` 反代到 API 服务）
- 修复后台投稿的帖子未写入指纹导致收不到评论提醒的问题
- 修复后台概览“总访问量”误用本周访问量的问题（改为全量累计）
- 修复搜索页点击“搜索”会触发重复请求的问题
