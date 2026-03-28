## [Unreleased]

### Changed

- 投稿页输入区升级为基于 `CodeMirror 6` 的 Markdown 编辑器，保留原有手绘卡片 UI、预览切换、图片上传、表情插入、标签选择与提交流程；涉及 `components/MarkdownEditor.tsx`、`components/SubmissionView.tsx`、`package.json`。
- 投稿页快捷格式栏改为中文短文案，并针对移动端收敛为更紧凑的两行布局。
- 前台投稿改为必须选择至少 1 个标签，未选标签时保持现有页面文案不变，并通过 toast 给出提交提示；涉及 `components/SubmissionView.tsx`。
- 前台新增标签屏蔽设置：桌面端提供独立右上角入口，移动端入口折叠进菜单栏，并通过本地存储记住用户选择；涉及 `App.tsx`、`components/UserSettingsModal.tsx`、`store/AppContext.tsx`、`store/hiddenPostTags.ts`。

### Fixed

- Markdown 预览补齐单次回车换行解析，避免输入内容后必须连续两次回车才能在预览区换行；涉及 `components/MarkdownRenderer.tsx`。
- 首页与热门支持按已屏蔽标签过滤帖子，并修正首页列表模式在首批结果全部被屏蔽时的继续加载行为；涉及 `components/HomeView.tsx`、`components/FeedView.tsx`。

### Changed

- 首页新增“单帖 / 列表”双浏览模式，支持记住用户选择，并在分享路由下保持单帖聚焦浏览。
- 首页列表模式改为高密度卡片浏览：支持新标签页打开单帖、首次加载 20 条并通过底部按钮继续按 20 条加载，兼顾桌面端与移动端快速扫帖体验；涉及 `components/HomeView.tsx`、`components/HomePostGridCard.tsx`。
- 管理后台接入新身份体系：帖子、评论、反馈、举报、封禁列表与聊天室管理统一返回并展示 `identityKey` / `identityHashes`，搜索支持按主身份与关联身份命中。
- 管理封禁与聊天室禁言/踢出/封禁改为按身份链执行，并保留 IP 维度与旧指纹数据兼容，避免后台仍停留在仅按单个旧指纹处理。

### Fixed

- 修复分享路由带 `?comment=` 时评论弹窗会在点赞、收藏等局部状态刷新后重复弹出的行为；涉及 `components/HomeView.tsx`。
- 修复列表模式下评论弹窗在原帖子被刷新移出当前列表后，错误回退到其他帖子的风险；涉及 `components/HomeView.tsx`。
- 修复首页首屏加载过程中切换到列表模式时，初始请求与补量请求并发导致列表数量回退的问题；涉及 `components/HomeView.tsx`。

### Changed

- 指纹主身份切换为 `HttpOnly Cookie` `gs_client_id_v2`，服务端新增身份归一层与 `identity_aliases` 兼容映射；通知、封禁、举报、点赞/收藏、评论点赞、聊天室统一按新旧身份并行识别，涉及 `server/identity-service.js`、`server/index.js`、`server/chat-realtime-service.js`、`server/routes/public/*`、`components/ChatRoomView.tsx`。

### Changed

- 后台系统设置新增发帖、评论、举报、留言的限流配置，支持直接调整次数与时间窗口；涉及 `server/site-settings.js`、`server/routes/admin/settings-routes.js`、`components/AdminDashboard.tsx`、`api.ts`。

### Fixed

- 补齐身份归一的稳定键策略：聊天室会复用同一 identity graph 下的在线 presence，发帖/评论/举报限流统一按稳定身份键计数，避免更换浏览器指纹后被误识别为新用户；涉及 `server/identity-service.js`、`server/index.js`、`server/chat-realtime-service.js`、`server/tests/identity-service.test.js`、`server/tests/chat-realtime-service.test.js`。
- 修复移动端点击标签进入搜索页后，长标签与长链接可能导致导航栏下方内容超宽、页面可横向滑动的问题；涉及 `components/SearchView.tsx`、`components/HomeView.tsx`、`components/FeedView.tsx`、`components/SketchUI.tsx`、`App.tsx`。
- 统一 Markdown 链接与正文的换行策略，避免链接换行过碎，并保持评论区与帖子正文的浏览体验一致；涉及 `components/MarkdownRenderer.tsx`、`index.css`、`components/CommentModal.tsx`。

### Added

- 新增帖子标签能力：发帖支持选择默认标签、为当前帖子新增标签，并限制每帖最多 2 个标签。
- 新增标签搜索与跳转：帖子标签可点击跳转到 /search?tag=...，搜索页支持按关键字与标签组合筛选。
- 新增后台系统设置项 defaultPostTags，用于集中管理默认帖子标签。

### Changed

- 标签规则统一收敛到前后端：单个标签最多 6 个字，超长/重复/空标签会被自动过滤。
- 发帖页标签展示改为仅使用后台配置的默认标签，不再自动进入公共标签池。
### Changed

- 新增单聊天室入口 `/chat`，前端支持匿名实时聊天、在线人数/用户列表（按人去重）、退出重进随机“侠士编号”。
- 后端新增 WebSocket 实时服务（`/ws/chat`），支持消息广播、在线状态广播、断线重连与心跳清理。
- 聊天室管理新增规则配置：支持聊天室开关、全体禁言、仅管理员发言、发言频率与单条最大字数限制。
- 关闭聊天室时，前台聊天室入口同步关闭；在线连接收到 `chat.closed` 后退出并停止重连。
- 封禁权限扩展 `chat`，可对聊天室进行独立封禁，不影响既有帖子/评论权限模型。
- 后端管理高风险接口完成 service/repository 下沉：帖子批量处置、举报处置、封禁/解封逻辑从路由中抽离到可复用服务层。
- server/routes/admin/posts-routes.js、server/routes/admin/reports-routes.js、server/routes/admin/bans-routes.js 改为调用统一 moderation service，保持原有接口行为与返回结构。

### Added

- 新增聊天室数据表：`chat_sessions`、`chat_messages`、`chat_mutes`（含消息去重与删除字段）。
- 新增公共聊天室接口：`GET /api/chat/online`、`GET /api/chat/history`。
- 新增聊天室配置接口：`GET /api/admin/chat/config`、`POST /api/admin/chat/config`。
- 新增 `GET /api/settings` 字段 `chatEnabled`，用于前台聊天室入口显隐控制。
- 聊天室关闭时，`/api/chat/online`、`/api/chat/history`、`/api/chat/messages/:id/report` 统一返回 `503`。
- 新增后台聊天室管理接口：在线用户、消息删除、禁言/解禁、踢出、封禁/解封。
- 新增前端聊天室页面 `components/ChatRoomView.tsx`，复用现有表情包与图床上传能力。
- 新增后台聊天室管理面板 `components/AdminChatPanel.tsx` 并接入 `AdminDashboard`。
- 文档更新：`README.md`、`docs/03-数据模型(SQLite).md`、`docs/04-后端API与权限.md`、`docs/05-后台管理功能.md`。
- 新增 server/repositories/moderation-repository.js，集中管理高风险接口涉及的数据库访问。
- 新增 server/services/admin-moderation-service.js，统一封装批量处置、举报处置、封禁解封等业务编排。
- 新增回归测试 server/tests/admin-moderation-service.test.js，覆盖帖子批量封禁、举报封禁、封禁解封、举报批量处置四个关键场景。
- 新增脚本 npm run test:server，用于执行服务层最小回归测试。

### Added

- 接入图床上传能力（前端直传）：新增 `api.uploadImage`，投稿与评论支持上传图片并插入 Markdown 图片链接（`![](url)`）。
- 新增环境变量示例：`.env.example` 增加 `VITE_IMGBED_BASE_URL` / `VITE_IMGBED_TOKEN`。
- 新增春节主题能力：后端设置新增 `cny_theme_enabled`，公开/后台设置接口返回 `cnyThemeEnabled`、`cnyThemeAutoActive`、`cnyThemeActive`，并支持农历腊月十六至正月十五自动生效。
- 新增春节视觉组件 `components/CNY/*`（灯笼、头部纹饰、红包/金币飘落），并扩展 Tailwind 与全局春节背景样式。
- 新增春节氛围画布背景组件 `components/CNY/CNYAtmosphereBackground.tsx`，用于春节模式下的动态粒子背景。

### Changed

- 评论区体验调整：评论弹窗不再展示帖子详情；评论区图片展示尺寸更紧凑以适配布局。
- 投稿页编辑工具条调整：预览/图片/表情按钮保持固定位置（`sticky`），避免滚动时跳动。
- 图片上传轻量限频：同一浏览器会话内约 30 秒最多 3 次，超出会提示稍等再试（防刷不打扰正常使用）。
- 后台“系统设置”增加春节皮肤开关与自动时段状态展示；前台导航栏改为春节红金样式（含 `福` 字徽标），页脚保持原始样式不变。
- 春节掉落装饰改为红包与金币全屏随机分布，并周期性重随机，避免元素长期集中在单侧。
- 春节背景由 `body.theme-cny` 静态纹理切换为节日画布背景渲染，默认主题背景不变。

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



