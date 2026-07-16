## [Unreleased]

### Added

- 新增帖子精华申请与审核链路：帖子举报入口统一改为三点菜单，用户确认后即可申请加精；同一身份同帖只可申请一次，并增加独立可配置限流。
- 新增前台 `/featured` 精华频道和桌面/移动端导航入口，按加精时间倒序展示当前公开精华帖子。
- 新增后台「精华管理」，支持按帖子聚合审核申请、查看已处理记录、直接新增精华和取消精华；审核结果接入站内通知与操作审计。
- 新增精华数据迁移、公共/后台 API 和服务端回归测试；帖子隐藏或删除时自动取消精华。
- 商城商品支持 **阶梯定价**（如 `10/1天`、`70/7天`、`300/永久`）：商品 `price_tiers` JSON，前台按档位兑换/续期。涉及 `shop-inventory.js`、`frame-service`、`name-style-service`、`UserMeModal`。
- 后台阶梯定价改为可视化编辑器（瓜子 + 时长预设/自定义 + 增删档 + 预览 chips）；前台改为分段档位卡 + 主价位摘要。涉及 `PriceTiersEditor`、`ShopPriceTiers`。
- 商城管理增加 **商城总开关**（`shop_enabled`，默认关闭）：关闭时前台「我的」无商城入口，相关 `/api/me/shop*` 返回 403。涉及 `site-settings.js`、`AdminShopView`、`AppContext`。
- 商城管理可配置 **每日签到瓜子**（`shop_daily_claim_coins`，默认 10），并支持按指纹查询/增减用户瓜子。涉及 `admin/shop-routes.js`、`AdminShopView`。
- 商城商品支持 **价格 + 有效期（天）**（如 10 瓜子 / 1 天）；到期自动卸下装备并恢复默认头像框/昵称颜色，限时可续期。涉及 `duration_days`、库存 `{id,expiresAt}`、`shop-inventory.js`。
- 商城新增栏目「炫彩昵称」：可兑换「红色昵称」（`vip-red`，80 瓜子）；装备后**新发帖与新评论/回复**快照生效，他人可见。
- 后台「商城管理」同步增加「炫彩昵称」Tab：支持用 **RGB / 取色器** 直接添加与改色；数据表 `name_styles`；公开 `GET /api/name-styles`。涉及 `server/name-style-service.js`、`AdminNameStylesView`、`ColorfulName` 动态着色。
- 商城新增史诗头像框「极光棱镜」（`aurora-prism`，180 瓜子）：旋转棱镜描边、流光扫过、星点闪烁与渐变昵称动效。
- 后台侧栏将头像框并入 **商城管理** 入口（`AdminShopView`），头像框为初期商品线，便于后续扩展其它商城商品。
- 新增头像框后台管理与 Frame Package（schemaVersion 2）导入：支持粘贴 JSON / 导入 `.json` 文件，CSS 动效经消毒后由 Shadow DOM `FrameRuntime` 渲染；后台可改价、上下架、排序、导出。涉及 `server/frame-package.js`、`server/frame-service.js`、`server/routes/admin/nickname-frames-routes.js`、`features/admin/views/AdminNicknameFramesView.tsx`、`components/FrameRuntime.tsx`。
- 新增表 `nickname_frames` 与访客 `user_cosmetics` 商城链路；公开 `GET /api/frames`、`/api/me/shop*`；发帖快照 `posts.author_frame_id`（仅新帖生效，他人可见）。涉及 `server/db.js`、`server/routes/public/shop-routes.js`、`server/routes/public/frames-routes.js`、前台「我的」商城。
- 新增服务端回归测试 `server/tests/frame-package.test.js`、`server/tests/frame-post-snapshot.test.js`。

- 新增独立角色 Wiki：前台提供 `/wiki` 角色画廊和 `/wiki/:slug` 详情页，采用 Nordic Wiki 视觉，不继承主站手绘风格；瓜条保存名字、记录叙述、tags 及结构化相关资料。
- 新增 Wiki 投稿和编辑审核链路：用户提交新瓜条或编辑已有瓜条后进入后台审核，通过后才公开，拒绝不影响当前公开内容。
- 新增后台 `Wiki 审核` 模块，支持待审核、已通过、已拒绝和瓜条管理，并对通过、拒绝、删除、恢复、管理员编辑写入审计日志。
- 新增瓜条相关资料：每条瓜条最多关联 5 个站内帖子，并支持最多 5 组、总计 10 张的分组图片附件；公开详情、历史版本和后台审核均可查看，失效帖子不会泄露摘要。
- 新增后台瓜条相关帖子与附件编辑器，支持批量选图、上传进度、失败重试、缩略图预览和分组图片查看。
- 新增 `wiki_entries`、`wiki_entry_revisions` 数据表和 Wiki 公共/后台 API，并增加 `wiki` 投稿限流；图片上传统一使用默认 `12 次 / 分钟` 的 `upload` 限流，避免客户端切换用途绕过额度。
- 新增 Wiki 路由回归测试，覆盖投稿、编辑、审核通过、审核拒绝、历史展示和删除不可公开等场景。

### Changed

- 热门榜改为分级公共排行缓存与分页补取：今日缓存 15 分钟、近 7 天缓存 30 分钟、历史缓存 60 分钟；接口默认仅补全 30 条帖子及当前访客状态，前端按筛选复用缓存并在本地屏蔽后不足 10 条时继续取下一批。
- 热门榜改为纯互动热度：不再使用浏览量，按近期点赞、收藏、独立评论者、封顶后的额外评论和点踩计算，并对今日/近 7 天互动做时间衰减；今日按北京时间自然日统计，普通页面不再使用固定分数门槛标记热门。
- 移除聊天室功能：删除前台聊天室、后台聊天室管理、聊天室 WebSocket/HTTP 接口、聊天室数据表初始化、相关测试与直接 `ws` 依赖；保留历史聊天室举报过滤以兼容旧数据。
- 图片上传改为服务端代理，图床 Token 不再进入前端构建产物；上传限频纳入后台系统设置。
- 图片上传代理统一拒绝外部 HTTP、带凭据和非 HTTP(S) 图床地址，并禁止自动跟随上游重定向；Wiki 附件新写入同样仅允许 HTTPS 或本地回环 HTTP。
- `npm run test:server` 改为自动运行 `server/tests/*.test.js` 下全部服务端测试。
- 提取身份 SQL 匹配与剪贴板复制公共工具，减少重复实现。
- 拆分后台系统设置页的限流、默认标签、自动隐藏阈值、春节状态与企业微信提醒组件，降低 `AdminDashboard.tsx` 维护成本。
- 拆出聊天室身份、限流、图片、表情和配置归一化工具，并补充回归测试。

- 前台帖子正文与评论区图片改为站内查看器：点击 Markdown 图片会在页内打开可缩放、拖拽、左右切换的图片查看层，普通链接仍保持新标签页打开；涉及 `components/MarkdownRenderer.tsx`、`components/FeedView.tsx`、`components/HomeView.tsx`、`components/FavoritesView.tsx`、`components/CommentModal.tsx`、`index.css`、`index.tsx`。

- 设置弹窗改为“屏蔽标签 / 更新公告”双模块切换，更新公告支持展示历史记录；涉及 `components/UserSettingsModal.tsx`、`api.ts`、`types.ts`。
- 新增轻量“更新公告”数据链路：前台新增 `GET /api/update-announcements` 和 `GET /api/update-announcements/latest`，后台新增更新公告发布与删除接口，并落库到 `update_announcements`；涉及 `server/db.js`、`server/index.js`、`api.ts`。
- 抽出共享 Markdown 发布编辑器，前台投稿与后台投稿/站点公告/更新公告统一为同一套 Markdown 工具栏、预览、图片上传、粘贴上传与表情插入方案；涉及 `components/MarkdownComposeEditor.tsx`、`components/SubmissionView.tsx`、`components/AdminDashboard.tsx`。
- 投稿页输入区升级为基于 `CodeMirror 6` 的 Markdown 编辑器，保留原有手绘卡片 UI、预览切换、图片上传、表情插入、标签选择与提交流程；涉及 `components/MarkdownEditor.tsx`、`components/SubmissionView.tsx`、`package.json`。
- 投稿页快捷格式栏改为中文短文案，并针对移动端收敛为更紧凑的两行布局。
- 前台投稿改为必须选择至少 1 个标签，未选标签时保持现有页面文案不变，并通过 toast 给出提交提示；涉及 `components/SubmissionView.tsx`。
- 前台新增标签屏蔽设置：桌面端提供独立右上角入口，移动端入口折叠进菜单栏，并通过本地存储记住用户选择；涉及 `App.tsx`、`components/UserSettingsModal.tsx`、`store/AppContext.tsx`、`store/hiddenPostTags.ts`。

### Fixed

- 修复热门榜完整正文随排行长时间缓存的问题：排行仍按今日 15 分钟、近 7 天 30 分钟、历史 60 分钟复用，正文与访客状态最多缓存 2 分钟，并在到期、重新聚焦或页面恢复可见时检查刷新；加载失败会保留旧榜单并提供明确错误与重试入口。
- 修复热门榜隐藏/删除后的分页计数、搜索分页跳项和历史无身份评论误算独立用户的问题；分页版本改为绑定当前有序公开结果的稳定值，搜索限制为 80 字符并按字面量处理 `%`、`_` 通配符。
- 修复评论粘贴图片可并发上传、上传期间仍能发布，以及旧上传结果写入已关闭或已清空草稿的问题；桌面与移动端现在共用上传互斥状态。
- 修复懒加载视图失败后整页无法恢复的问题，并加强前端部署检查：PM2 固定以 SPA 模式启动，`/` 与 `/feed` 必须返回包含应用根节点的 HTTP 200 HTML。
- 将 `/feed` 纳入固定 Lighthouse 性能预算路由，避免热门页改动绕过上线性能检查。
- Google 字体改为变量字体范围并异步启用，移除已无代码引用的 Material Symbols 外链，减少字体 CSS 与字体文件数量并避免阻塞首屏渲染。
- 修复热门页缺少独立路由映射的问题，新增 `/feed` 路径，并让组件代码与默认榜单请求在导航意图或直达页面时提前并行加载。
- 修复前台与后台 Wiki 附件中部分 PNG 因非标准或缺失 MIME 被误判的问题，并支持在附件卡片内通过 `Ctrl+V` 粘贴图片。
- 修复首页列表模式打开单帖后，“下一个瓜”错误回到最新帖的问题；详情链接会携带列表位置并在单帖页恢复原序列位置，涉及 `components/HomeView.tsx`、`components/clipboard.ts`。
- Markdown 预览补齐单次回车换行解析，避免输入内容后必须连续两次回车才能在预览区换行；涉及 `components/MarkdownRenderer.tsx`。
- 首页与热门支持按已屏蔽标签过滤帖子，并修正首页列表模式在首批结果全部被屏蔽时的继续加载行为；涉及 `components/HomeView.tsx`、`components/FeedView.tsx`。

- 首页新增“单帖 / 列表”双浏览模式，支持记住用户选择，并在分享路由下保持单帖聚焦浏览。
- 首页列表模式改为高密度卡片浏览：支持新标签页打开单帖、首次加载 20 条并通过底部按钮继续按 20 条加载，兼顾桌面端与移动端快速扫帖体验；涉及 `components/HomeView.tsx`、`components/HomePostGridCard.tsx`。
- 管理后台接入新身份体系：帖子、评论、反馈、举报、封禁列表与聊天室管理统一返回并展示 `identityKey` / `identityHashes`，搜索支持按主身份与关联身份命中。
- 管理封禁与聊天室禁言/踢出/封禁改为按身份链执行，并保留 IP 维度与旧指纹数据兼容，避免后台仍停留在仅按单个旧指纹处理。

### Fixed

- 修复分享路由带 `?comment=` 时评论弹窗会在点赞、收藏等局部状态刷新后重复弹出的行为；涉及 `components/HomeView.tsx`。
- 修复列表模式下评论弹窗在原帖子被刷新移出当前列表后，错误回退到其他帖子的风险；涉及 `components/HomeView.tsx`。
- 修复首页首屏加载过程中切换到列表模式时，初始请求与补量请求并发导致列表数量回退的问题；涉及 `components/HomeView.tsx`。

- 指纹主身份切换为 `HttpOnly Cookie` `gs_client_id_v2`，服务端新增身份归一层与 `identity_aliases` 兼容映射；通知、封禁、举报、点赞/收藏、评论点赞、聊天室统一按新旧身份并行识别，涉及 `server/identity-service.js`、`server/index.js`、`server/chat-realtime-service.js`、`server/routes/public/*`、`components/ChatRoomView.tsx`。

- 后台系统设置新增发帖、评论、举报、留言的限流配置，支持直接调整次数与时间窗口；涉及 `server/site-settings.js`、`server/routes/admin/settings-routes.js`、`components/AdminDashboard.tsx`、`api.ts`。

### Fixed

- 补齐身份归一的稳定键策略：聊天室会复用同一 identity graph 下的在线 presence，发帖/评论/举报限流统一按稳定身份键计数，避免更换浏览器指纹后被误识别为新用户；涉及 `server/identity-service.js`、`server/index.js`、`server/chat-realtime-service.js`、`server/tests/identity-service.test.js`、`server/tests/chat-realtime-service.test.js`。
- 修复移动端点击标签进入搜索页后，长标签与长链接可能导致导航栏下方内容超宽、页面可横向滑动的问题；涉及 `components/SearchView.tsx`、`components/HomeView.tsx`、`components/FeedView.tsx`、`components/SketchUI.tsx`、`App.tsx`。
- 统一 Markdown 链接与正文的换行策略，避免链接换行过碎，并保持评论区与帖子正文的浏览体验一致；涉及 `components/MarkdownRenderer.tsx`、`index.css`、`components/CommentModal.tsx`。

### Added

- 新增帖子标签能力：发帖支持选择默认标签、为当前帖子新增标签，并限制每帖最多 2 个标签。
- 新增标签搜索与跳转：帖子标签可点击跳转到 /search?tag=...，搜索页支持按关键字与标签组合筛选。
- 新增后台系统设置项 defaultPostTags，用于集中管理默认帖子标签。

- 标签规则统一收敛到前后端：单个标签最多 6 个字，超长/重复/空标签会被自动过滤。
- 发帖页标签展示改为仅使用后台配置的默认标签，不再自动进入公共标签池。
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

- 接入图床上传能力：新增 `api.uploadImage`，投稿与评论支持上传图片并插入 Markdown 图片链接（`![](url)`）。
- 新增环境变量示例：`.env.example` 增加 `IMGBED_BASE_URL` / `IMGBED_TOKEN`。
- 新增春节主题能力：后端设置新增 `cny_theme_enabled`，公开/后台设置接口返回 `cnyThemeEnabled`、`cnyThemeAutoActive`、`cnyThemeActive`，并支持农历腊月十六至正月十五自动生效。
- 新增春节视觉组件 `components/CNY/*`（灯笼、头部纹饰、红包/金币飘落），并扩展 Tailwind 与全局春节背景样式。
- 新增春节氛围画布背景组件 `components/CNY/CNYAtmosphereBackground.tsx`，用于春节模式下的动态粒子背景。

- 评论区体验调整：评论弹窗不再展示帖子详情；评论区图片展示尺寸更紧凑以适配布局。
- 投稿页编辑工具条调整：预览/图片/表情按钮保持固定位置（`sticky`），避免滚动时跳动。
- 图片上传服务端统一限频：默认同一会话/IP/身份 30 秒最多 3 次，超出会提示稍等再试。
- 后台“系统设置”增加春节皮肤开关与自动时段状态展示；前台导航栏改为春节红金样式（含 `福` 字徽标），页脚保持原始样式不变。
- 春节掉落装饰改为红包与金币全屏随机分布，并周期性重随机，避免元素长期集中在单侧。
- 春节背景由 `body.theme-cny` 静态纹理切换为节日画布背景渲染，默认主题背景不变。

### Fixed

- 图片上传改为服务端代理读取图床密钥，前端不再读取或打包图床 Token。
- 修复图片上传代理请求的指纹头保留问题，并将上传体解析错误返回为明确的 400/413 响应。

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

- 设置弹窗改为“屏蔽标签 / 更新公告”双模块切换，更新公告支持展示历史记录；涉及 `components/UserSettingsModal.tsx`、`api.ts`、`types.ts`。
- 新增轻量“更新公告”数据链路：前台新增 `GET /api/update-announcements` 和 `GET /api/update-announcements/latest`，后台新增更新公告发布与删除接口，并落库到 `update_announcements`；涉及 `server/db.js`、`server/index.js`、`api.ts`。
- 抽出共享 Markdown 发布编辑器，前台投稿与后台投稿/站点公告/更新公告统一为同一套 Markdown 工具栏、预览、图片上传、粘贴上传与表情插入方案；涉及 `components/MarkdownComposeEditor.tsx`、`components/SubmissionView.tsx`、`components/AdminDashboard.tsx`。- 关键页面改为懒加载，并延迟后台轮询/任务，降低首屏 JS 压力
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

