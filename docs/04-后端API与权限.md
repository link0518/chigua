# 04｜后端 API 与权限

本章仅列出“接口清单 + 鉴权/安全要求 + 业务含义”。按你的要求：**不提供具体请求/响应示例**。

## 1. 约定与安全机制

### 1.1 统一前缀

前端统一请求 `/api/*`，由 Vite proxy（开发模式）或反向代理（生产模式）转发到后端。

### 1.2 Session（管理员登录依赖）

后端使用 cookie session。前端请求默认 `credentials: 'include'`（见 `api.ts`）。

### 1.3 CSRF（后台/举报相关）

部分敏感接口会要求 `X-CSRF-Token`（见前端 `api.ts` 的 `needsAdminCsrf()` 判断）。

### 1.4 客户端身份（Cookie + X-Client-Fingerprint）

后端不再只依赖单一指纹，而是同时使用：

- `gs_client_id_v2`：服务端补发的 `HttpOnly Cookie`，用于生成较稳定的 canonical 身份
- `X-Client-Fingerprint`：前端按路径选择性附带的 legacy 指纹（见 `api.ts` 的 `shouldAttachFingerprint()`）

服务端会把二者关联到 `identity_aliases`，为当前请求生成一组 `lookupHashes`，并在风控、封禁判断、通知读取、互动状态查询中复用。

### 1.5 身份归一的影响范围

- `GET /api/access`：按 `IP + lookupHashes` 计算是否被封禁与权限收窄
- 通知/连续登录彩蛋/反馈频控：会聚合同一身份下的多个历史哈希
- 帖子点赞、点踩、收藏、评论点赞、举报去重：会跨 linked hashes 查询既有状态，避免“换指纹后重复算新用户”

## 2. 后台管理员权限

后台管理员分为：

- `super_admin`：环境变量管理员，拥有全部权限。
- `admin`：普通管理员，只能访问已授权模块。

普通管理员模块权限：

- `content_review`：内容审核（举报、隐藏内容、谣言审核、帖子删除申请）
- `posts`：帖子管理
- `wiki`：Wiki 管理
- `feedback`：留言管理
- `user_safety`：用户处置
- `publish`：发布中心
- `settings`：系统设置

权限等级：

- `read`：可查看。
- `manage`：可查看并执行处理动作。

后端权限检查是最终安全边界；前端菜单和按钮只做展示控制。`audit` 和 `admin-users` 不可分配给普通管理员，只允许超级管理员访问。

## 3. 公共 API（无需管理员）

以下路由来自 `server/index.js`：

- `GET /api/health`：健康检查
- `GET /api/access`：访问控制状态（是否被封禁、过期时间等）
- `GET /api/settings`：公开设置（`turnstileEnabled`、`cnyThemeEnabled`、`cnyThemeAutoActive`、`cnyThemeActive`）
- `GET /api/announcement`：公告内容
- `GET /api/update-announcements`：更新公告历史列表
- `GET /api/update-announcements/latest`：更新公告最新更新时间，用于前台未读红点轻量检查

在线/通知/彩蛋：

- `POST /api/online/heartbeat`：在线心跳
- `GET /api/notifications`：拉取通知列表
- `POST /api/notifications/read`：标记通知已读
- 通知类型包括互动通知、谣言审核结果、管理员留言回复和帖子删除申请审核结果
- `GET /api/easter-eggs/streak7`：查询“连续登录 7 天”状态
- `POST /api/easter-eggs/streak7/seen`：标记彩蛋已看过

- `POST /api/feedback`：提交反馈（可带联系方式与 turnstile token）

帖子：

- `GET /api/posts/home`：首页帖子列表（分页）
- `GET /api/posts/feed`：榜单/热门流（带筛选参数）
- `GET /api/posts/search`：帖子搜索（分页）
- `POST /api/posts`：发帖（通常需要 turnstile 校验）
- `GET /api/posts/:id`：帖子详情
- `POST /api/posts/:id/delete-requests`：发帖人提交删除申请，需填写原因；待审核期间帖子继续公开
- 若后台已启用企业微信 Webhook，提交删除申请成功后会异步推送待审核提醒；推送失败不影响接口返回
- `POST /api/posts/:id/like`：点赞
- `POST /api/posts/:id/dislike`：点踩
- `POST /api/posts/:id/favorite`：收藏/取消收藏
- `GET /api/favorites`：我的收藏列表
- `POST /api/posts/:id/view`：浏览计数/去重
- 发帖成功时，若身份已装备有效昵称框，则将 `author_frame_id` 写入该帖快照；列表/详情对所有访客返回该字段（旧帖无快照则为空）

商城 / 头像框：

- `GET /api/me/shop`：瓜子余额、已拥有/装备、在售目录（含 render CSS）（需指纹）
- `POST /api/me/shop/claim-daily`：每日领取瓜子（默认 10）
- `POST /api/me/shop/redeem`：兑换在售框
- `POST /api/me/shop/equip`：装备/卸下已拥有框（`off_sale` 仍可装备；`hidden` 无效）
- `POST /api/me/shop/name-styles/redeem`：兑换炫彩昵称（如红色昵称）
- `POST /api/me/shop/name-styles/equip`：装备/卸下炫彩昵称
- `GET /api/me/shop` 另返回 `nameStyles`（含 `color` RGB / `colorCss` / `colorHex`）与 `equippedNameStyleId`
- 发帖/评论时将当前装备的炫彩昵称写入 `author_name_style_id` 快照（发帖与回复均生效）
- `GET /api/frames`：公开渲染目录（`on_sale` + `off_sale`，用于帖子展示）
- `GET /api/frames/:id`：单个框渲染数据
- `GET /api/name-styles`：公开炫彩昵称目录（含 RGB，供帖子/评论着色）
- `GET /api/name-styles/:id`：单个炫彩昵称

评论：

- `GET /api/posts/:id/comments`：获取评论（通常为顶层评论分页）
- `GET /api/posts/:id/comment-thread`：获取某条评论 thread（含上下文/回复树）
- `POST /api/posts/:id/comments`：发表评论/回复（通常需要 turnstile 校验）
- `POST /api/comments/:id/like`：评论点赞

举报：

- `POST /api/reports`：提交举报（帖子/评论）
- 举报请求统一支持 `reason`、`reasonCode`、`evidence` 三个字段：
  - `reasonCode` 可为 `privacy` / `harassment` / `spam` / `misinformation` / `rumor`
  - 当 `reasonCode = 'rumor'` 时，必须额外传 `evidence`，用于填写判断为谣言的原因或证据
  - 仍兼容只传 `reason` 的旧调用方式

## 4. 管理员 API（需登录）

管理员鉴权主要通过 `requireAdmin` 中间件，业务模块再按 `read` / `manage` 校验，常见敏感操作还会额外要求 `requireAdminCsrf`。

商城管理（复用 `settings` 模块权限；后台 UI 入口为「商城管理」）：

头像框：

- `GET /api/admin/nickname-frames`：列表（含 hidden）（`settings:read`）
- `POST /api/admin/nickname-frames/validate`：校验 Frame Package JSON（`settings:read`）
- `POST /api/admin/nickname-frames/import`：导入/创建或 upsert 覆盖（`settings:manage` + CSRF）
- `PATCH /api/admin/nickname-frames/:id`：改价/改名/状态/排序（`settings:manage` + CSRF）
- `GET /api/admin/nickname-frames/:id/export`：导出框包 JSON（`settings:read`）

炫彩昵称（RGB）：

- `GET /api/admin/name-styles`：列表（`settings:read`）
- `POST /api/admin/name-styles`：直接添加（`settings:manage` + CSRF），body 含 `id,name,price,color:{r,g,b}` 或 `color:"#RRGGBB"` / `"r,g,b"`
- `PATCH /api/admin/name-styles/:id`：改价/改名/状态/RGB（`settings:manage` + CSRF）

框包格式（schemaVersion 2）要点：

- `frame`：id / name / price / rarity / status / sort / grantOnRegister
- `render`：`engine=css-slots-v1`、`html=default-v1`、`css`（可含 @keyframes 动效）、可选 assets data URL
- 服务端消毒 CSS：禁止 `@import`、外链 `url(http...)`、`expression`、`position:fixed`、JS 相关语法
- 支持粘贴 JSON 或上传 `.json` 文件（前端读文本后走 import）

举报处置：

- `GET /api/reports`：获取待处理举报（`content_review:read`）
- `POST /api/reports/:id/action`：处理举报（ignore/delete/mute/ban 等）（`content_review:manage` + CSRF）
- `POST /api/admin/reports/batch`：批量处理举报（`content_review:manage` + CSRF）
- 普通举报列表默认不返回“举报谣言”类记录；该类内容由独立的谣言审核接口处理

谣言审核：

- `GET /api/admin/rumors`：获取谣言审核列表（`content_review:read`）
- 支持 `status=pending|suspected|rejected|all`
- 支持 `targetType=post|comment|all`
- 支持 `q / search / page / limit` 查询参数
- `POST /api/admin/rumors/:targetType/:targetId/action`：处理谣言审核动作（`content_review:manage` + CSRF）
- 支持动作：
  - `mark`：标记为 `suspected`
  - `reject`：标记为 `rejected`
  - `clear`：清空谣言标记
- `mark` / `reject` 会把该目标下仍处于 `pending` 的谣言举报批量置为 `resolved`
- 若后台已启用企业微信 Webhook，`mark` / `reject` / `clear` 成功后会异步推送谣言审核结果提醒；推送失败不影响接口返回

帖子删除申请审核：

- `GET /api/admin/post-delete-requests?status=pending|processed&page=&limit=`：查看删除申请队列（`content_review:read`）
- `POST /api/admin/post-delete-requests/:id/action`：审核删除申请（`content_review:manage` + CSRF）
- 支持动作：
  - `approve`：申请置为 `approved`，帖子软删除，并通知申请人
  - `reject`：申请置为 `rejected`，帖子保持公开，并通知申请人
- 审核说明可选；为空时通知使用默认文案

帖子管理：

- `GET /api/admin/posts`：后台帖子列表（`posts:read`）
- `POST /api/admin/posts`：后台发帖/公告式发帖（`publish:manage` + CSRF）
- `POST /api/admin/posts/:id/edit`：编辑帖子（`posts:manage` + CSRF）
- `POST /api/admin/posts/:id/action`：对帖子执行动作（删除/恢复/封禁等）（`posts:manage` + CSRF）
- `POST /api/admin/posts/batch`：帖子批量动作（`posts:manage` + CSRF）
- `GET /api/admin/posts/:id/comments`：查看某帖评论（`posts:read`）

评论管理：

- `POST /api/admin/comments/:id/action`：删除/封禁某评论作者（`posts:manage` + CSRF）

反馈与封禁：

- `GET /api/admin/feedback`：反馈列表（`feedback:read`）
- `POST /api/admin/feedback/:id/action`：处理反馈（`feedback:manage` + CSRF）
- `POST /api/admin/feedback/:id/replies`：回复留言并通知提交者（`feedback:manage` + CSRF）
- `GET /api/admin/bans`：封禁列表（`user_safety:read`）
- `POST /api/admin/bans/action`：封禁/解封（`user_safety:manage` + CSRF）

- `GET /api/admin/audit-logs`：后台操作审计日志（仅 `super_admin`），支持 `search`、`action`、`category`、`targetType`、`adminUsername`、`riskLevel=high`、`from`、`to`、`hasReason` 筛选；响应项会返回派生的 `category` 和 `riskLevel` 供前端展示。
- `GET /api/admin/stats`：统计概览（登录后按模块权限返回对应统计字段）

公告/设置/敏感词：

- `GET /api/admin/announcement`：获取后台公告（`publish:read`）
- `POST /api/admin/announcement`：更新公告（`publish:manage` + CSRF）
- `POST /api/admin/announcement/clear`：清空公告（`publish:manage` + CSRF）
- `GET /api/admin/update-announcements`：获取更新公告列表（`publish:read`）
- `POST /api/admin/update-announcements`：发布更新公告（`publish:manage` + CSRF）
- `POST /api/admin/update-announcements/:id/delete`：删除更新公告（`publish:manage` + CSRF）
- `GET /api/admin/settings`：获取设置（`settings:read`）
- `POST /api/admin/settings`：更新设置（`settings:manage` + CSRF）
- `GET /api/admin/vocabulary`：敏感词列表（`settings:read`）
- `POST /api/admin/vocabulary`：新增敏感词（`settings:manage` + CSRF）
- `POST /api/admin/vocabulary/:id/toggle`：启用/禁用（`settings:manage` + CSRF）
- `POST /api/admin/vocabulary/:id/delete`：删除敏感词（`settings:manage` + CSRF）
- `POST /api/admin/vocabulary/import`：从文件导入（`settings:manage` + CSRF）
- `GET /api/admin/vocabulary/export`：导出（`settings:read`）

管理员账号管理（仅 `super_admin`）：

- `GET /api/admin/admin-users`：管理员账号列表。
- `GET /api/admin/admin-users/permission-definitions`：可分配权限定义。
- `POST /api/admin/admin-users`：创建普通管理员（需要 CSRF）。
- `POST /api/admin/admin-users/:id/permissions`：修改普通管理员权限（需要 CSRF）。
- `POST /api/admin/admin-users/:id/status`：禁用/启用普通管理员（需要 CSRF）。
- `POST /api/admin/admin-users/:id/password`：重置普通管理员密码（需要 CSRF）。

会话：

- `GET /api/admin/session`：查询当前后台登录状态（会包含 csrf token 等信息）
- `POST /api/admin/login`：登录
- `POST /api/admin/logout`：登出（管理员 + CSRF）

## 5. 权限/限流补充说明

服务端存在按行为的频控配置（例如评论频控）；封禁权限会影响发帖/评论/点赞/浏览/访问站点等（具体以后端判断为准）。

## 6. 角色 Wiki API

### 6.1 公开接口

- `GET /api/wiki/entries?q=&tag=&page=&limit=`：查询公开角色瓜条列表。只返回已审核通过且未删除的瓜条。
- `GET /api/wiki/entries/:slug`：查询公开角色详情，包含当前公开内容和已审核通过的编辑历史。
- `POST /api/wiki/submissions`：提交新角色瓜条，进入待审核。
- `POST /api/wiki/entries/:slug/edits`：提交已有角色瓜条编辑，进入待审核。

投稿和编辑请求体统一只接受：

- `name`：名字，必填。
- `narrative`：记录叙述，必填。
- `tags`：标签数组。
- `editSummary`：修改说明，可选。

公开接口不会返回待审核或已拒绝版本。提交成功只代表进入审核队列，不代表公开发布。

`GET /api/wiki/entries/:slug` 返回的公开历史必须脱敏，只保留前台展示所需的版本内容、版本号、审核通过时间和修改说明；不得返回提交者 IP、提交者指纹、后台审核账号等审计元数据。

### 6.2 后台接口

以下接口均需要管理员登录，写操作需要 CSRF：

- `GET /api/admin/wiki/revisions?status=&actionType=&q=&page=&limit=`：查询 Wiki 审核记录（`wiki:read`）。
- `GET /api/admin/wiki/entries?status=&q=&page=&limit=`：查询 Wiki 瓜条管理列表（`wiki:read`）。
- `POST /api/admin/wiki/entries`：管理员直接创建公开瓜条（`wiki:manage` + CSRF）。
- `POST /api/admin/wiki/revisions/:id/action`：对投稿或编辑执行 `approve` / `reject`（`wiki:manage` + CSRF）。
- `POST /api/admin/wiki/entries/:id/edit`：管理员直接编辑当前公开瓜条（`wiki:manage` + CSRF）。
- `POST /api/admin/wiki/entries/:id/action`：对瓜条执行 `delete` / `restore`（`wiki:manage` + CSRF）。

审核通过规则：

- `create` 通过后创建公开瓜条，版本号为 `1`。
- `edit` 通过后覆盖当前公开瓜条，版本号 `+1`。
- `edit` 审核通过前必须校验待审记录的 `base_revision_id` 和 `base_version_number` 是否仍匹配当前公开瓜条；若瓜条已产生新版本，应拒绝直接覆盖并提示重新提交或手动合并。
- `reject` 不影响当前公开内容。

### 6.3 安全与限流

- Wiki 投稿和编辑会附带 `X-Client-Fingerprint`，并记录提交者指纹与 IP。
- Wiki 投稿和编辑执行 Turnstile 校验和封禁检查。
- 新增 `wiki` 限流配置，默认 `3 次 / 小时`。
- 后台审核、拒绝、删除、恢复、管理员创建和管理员编辑都写入 `admin_audit_logs`；审计查询会按 `action` 派生操作分类和风险等级，便于后台展示和筛选。
