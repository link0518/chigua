## [Unreleased]

### Added

- 接入图床上传能力（前端直传）：新增 `api.uploadImage`，投稿与评论支持上传图片并插入 Markdown 图片链接（`![](url)`）。
- 新增环境变量示例：`.env.example` 增加 `VITE_IMGBED_BASE_URL` / `VITE_IMGBED_TOKEN`。
- 新增春节主题能力：后端设置新增 `cny_theme_enabled`，公开/后台设置接口返回 `cnyThemeEnabled`、`cnyThemeAutoActive`、`cnyThemeActive`，并支持农历腊月十六至正月十五自动生效。
- 新增春节视觉组件 `components/CNY/*`（灯笼、头部纹饰、红包/金币飘落），并扩展 Tailwind 与全局春节背景样式。

### Changed

- 评论区体验调整：评论弹窗不再展示帖子详情；评论区图片展示尺寸更紧凑以适配布局。
- 投稿页编辑工具条调整：预览/图片/表情按钮保持固定位置（`sticky`），避免滚动时跳动。
- 图片上传轻量限频：同一浏览器会话内约 30 秒最多 3 次，超出会提示稍等再试（防刷不打扰正常使用）。
- 后台“系统设置”增加春节皮肤开关与自动时段状态展示；前台导航栏改为春节红金样式（含 `福` 字徽标），页脚保持原始样式不变。
- 春节掉落装饰改为红包与金币全屏随机分布，并周期性重随机，避免元素长期集中在单侧。

### Fixed

- 修复 Vite 环境变量读取：图床配置改为通过 `import.meta.env` 读取，避免已配置仍提示“未配置”。

### Fixed

- 评论弹窗“热门评论”右上角点赞按钮支持直接点赞/取消点赞，并与评论列表状态同步 `components/CommentModal.tsx`

- 修复铃铛提醒在页面切回前台/重新获得焦点时不即时刷新（仍保留 30s 轮询兜底）`App.tsx`
- 优化移动端帖子操作栏点击间距，降低“点踩/评论”误触 `components/HomeView.tsx`
- 修复安卓软键盘遮挡评论输入框：移动端聚焦时将输入区改为浮动层（键盘可见区居中）并锁定滚动 `components/CommentModal.tsx`
- 修复热门榜单首条帖子展开评论区与上方元素重叠（层叠上下文）`components/FeedView.tsx`
- 移动端评论输入统一改为弹窗编辑，避免键盘遮挡与闪退，并增强“正在回复 X楼”提示 `components/CommentModal.tsx` `components/CommentInputModal.tsx`

### Added
- 新增 Lighthouse 性能预算脚本 `npm run perf:budget`（Mobile + Desktop，覆盖主要路由）
- 新增 Lighthouse 配置（`lighthouserc.mobile.cjs`、`lighthouserc.desktop.cjs`）与预算校验脚本（`scripts/perf-budget.mjs` 等）
- 强制 Markdown 链接在新标签页打开，避免当前页跳转
- 模态框支持通过 `panelClassName` 自定义宽度
- 新增“帖子搜索”页面：仅按正文关键字搜索，支持分页，并在移动端菜单栏提供入口
- 首页横幅文案与样式优化：提示双域名并推荐使用 https://jx3gua.com/ 加速访问
- 后台投稿新增“携带开发者信息”开关（默认开启并记住上次选择），帖子内以开发者名片展示 `admin`
- 新增“连续登录 7 天”彩纸礼花彩蛋（按指纹识别，仅在首页触发一次）
- 新增 `.editorconfig`，统一使用 UTF-8 编码

### Changed
- 关键页面改为懒加载，并延迟后台轮询/任务，降低首屏 JS 压力
- 启用服务端响应压缩，并在生产环境提供 dist 静态资源以便本地预览与 Lighthouse 测量
- Vite 分包策略调整（拆分 react-vendor、recharts），减少首屏阻塞
- 图标改用 `lucide-react`，移除 Material Symbols 字体依赖
- 举报详情弹窗加宽，并对长指纹/标识使用更友好的断词换行
- 表情包选择器改为固定尺寸（桌面端 420×360），移动端改为底部抽屉展示
- 表情包侧边栏按分组顺序展示，默认分组固定置顶并显示为“默认”
- 表情短码扩展为支持分组：`[:标签:]`（默认包）与 `[:分组/标签:]`

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
- 修复表情包弹窗在评论区内被压缩/裁切导致无法展示的问题
