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

服务端会把二者关联到 `identity_aliases`，为当前请求生成一组 `lookupHashes`，并在风控、封禁判断、通知读取、互动状态查询与聊天室身份识别中复用。

### 1.5 身份归一的影响范围

- `GET /api/access`：按 `IP + lookupHashes` 计算是否被封禁与权限收窄
- 通知/连续登录彩蛋/反馈频控：会聚合同一身份下的多个历史哈希
- 帖子点赞、点踩、收藏、评论点赞、举报去重：会跨 linked hashes 查询既有状态，避免“换指纹后重复算新用户”
- `WS /ws/chat`：优先从 Cookie 解析身份；若解析不到，再回退到 join payload 中的 `fingerprint`

## 2. 公共 API（无需管理员）

以下路由来自 `server/index.js`：

- `GET /api/health`：健康检查
- `GET /api/access`：访问控制状态（是否被封禁、过期时间等）
- `GET /api/settings`：公开设置（`turnstileEnabled`、`cnyThemeEnabled`、`cnyThemeAutoActive`、`cnyThemeActive`、`chatEnabled`）
- `GET /api/announcement`：公告内容
- `GET /api/update-announcements`：更新公告历史列表
- `GET /api/update-announcements/latest`：更新公告最新更新时间，用于前台未读红点轻量检查

在线/通知/彩蛋：

- `POST /api/online/heartbeat`：在线心跳
- `GET /api/notifications`：拉取通知列表
- `POST /api/notifications/read`：标记通知已读
- `GET /api/easter-eggs/streak7`：查询“连续登录 7 天”状态
- `POST /api/easter-eggs/streak7/seen`：标记彩蛋已看过

聊天室（单房间）：

- `GET /api/chat/online`：获取当前在线人数与在线用户（按人去重）
- `GET /api/chat/history`：拉取历史消息（分页）
- `POST /api/chat/messages/:id/report`：举报聊天室消息
- `WS /ws/chat`：聊天室实时链路（join/send/leave、在线广播、消息广播、管理事件推送）
- 关闭聊天室时：`GET /api/chat/online` / `GET /api/chat/history` / `POST /api/chat/messages/:id/report` 会返回 `503`

反馈：

- `POST /api/feedback`：提交反馈（可带联系方式与 turnstile token）

帖子：

- `GET /api/posts/home`：首页帖子列表（分页）
- `GET /api/posts/feed`：榜单/热门流（带筛选参数）
- `GET /api/posts/search`：帖子搜索（分页）
- `POST /api/posts`：发帖（通常需要 turnstile 校验）
- `GET /api/posts/:id`：帖子详情
- `POST /api/posts/:id/like`：点赞
- `POST /api/posts/:id/dislike`：点踩
- `POST /api/posts/:id/favorite`：收藏/取消收藏
- `GET /api/favorites`：我的收藏列表
- `POST /api/posts/:id/view`：浏览计数/去重

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

## 3. 管理员 API（需登录）

管理员鉴权主要通过 `requireAdmin` 中间件，常见敏感操作还会额外要求 `requireAdminCsrf`。

举报处置：

- `GET /api/reports`：获取待处理举报（管理员）
- `POST /api/reports/:id/action`：处理举报（ignore/delete/mute/ban 等）（管理员 + CSRF）
- 说明：聊天室发言举报支持 `mute`（禁言）；执行 `ban` 时可通过 `deleteChatMessage` 选择是否删除被举报消息。
- `POST /api/admin/reports/batch`：批量处理举报（管理员 + CSRF）
- 普通举报列表默认不返回“举报谣言”类记录；该类内容由独立的谣言审核接口处理

谣言审核：

- `GET /api/admin/rumors`：获取谣言审核列表（管理员）
- 支持 `status=pending|suspected|rejected|all`
- 支持 `targetType=post|comment|all`
- 支持 `q / search / page / limit` 查询参数
- `POST /api/admin/rumors/:targetType/:targetId/action`：处理谣言审核动作（管理员 + CSRF）
- 支持动作：
  - `mark`：标记为 `suspected`
  - `reject`：标记为 `rejected`
  - `clear`：清空谣言标记
- `mark` / `reject` 会把该目标下仍处于 `pending` 的谣言举报批量置为 `resolved`
- 若后台已启用企业微信 Webhook，`mark` / `reject` / `clear` 成功后会异步推送谣言审核结果提醒；推送失败不影响接口返回

帖子管理：

- `GET /api/admin/posts`：后台帖子列表（管理员）
- `POST /api/admin/posts`：后台发帖/公告式发帖（管理员 + CSRF）
- `POST /api/admin/posts/:id/edit`：编辑帖子（管理员 + CSRF）
- `POST /api/admin/posts/:id/action`：对帖子执行动作（删除/恢复/封禁等）（管理员 + CSRF）
- `POST /api/admin/posts/batch`：帖子批量动作（管理员 + CSRF）
- `GET /api/admin/posts/:id/comments`：查看某帖评论（管理员）

评论管理：

- `POST /api/admin/comments/:id/action`：删除/封禁某评论作者（管理员 + CSRF）

反馈与封禁：

- `GET /api/admin/feedback`：反馈列表（管理员）
- `POST /api/admin/feedback/:id/action`：处理反馈（读/删/封禁等）（管理员 + CSRF）
- `GET /api/admin/bans`：封禁列表（管理员）
- `POST /api/admin/bans/action`：封禁/解封（管理员 + CSRF）

聊天室管理：

- `GET /api/admin/chat/config`：获取聊天室配置（管理员）
- `POST /api/admin/chat/config`：更新聊天室配置（管理员 + CSRF）
- `GET /api/admin/chat/online`：后台查看在线用户（含指纹哈希）
- `GET /api/admin/chat/messages`：后台查看聊天消息（可含已删除）
- `GET /api/admin/chat/mutes`：后台查看禁言列表
- `POST /api/admin/chat/messages/:id/delete`：删除聊天消息（管理员 + CSRF）
- `POST /api/admin/chat/users/:fingerprint/mute`：禁言用户（管理员 + CSRF）
- `POST /api/admin/chat/users/:fingerprint/unmute`：解除禁言（管理员 + CSRF）
- `POST /api/admin/chat/users/:fingerprint/kick`：踢出在线用户（管理员 + CSRF）
- `POST /api/admin/chat/users/:fingerprint/ban`：封禁用户（聊天室级或站点级，管理员 + CSRF）
- `POST /api/admin/chat/users/:fingerprint/unban`：解除封禁（管理员 + CSRF）

审计/统计：

- `GET /api/admin/audit-logs`：后台操作审计日志（管理员）
- `GET /api/admin/stats`：统计概览（管理员）

公告/设置/敏感词：

- `GET /api/admin/announcement`：获取后台公告（管理员）
- `POST /api/admin/announcement`：更新公告（管理员 + CSRF）
- `POST /api/admin/announcement/clear`：清空公告（管理员 + CSRF）
- `GET /api/admin/update-announcements`：获取更新公告列表（管理员）
- `POST /api/admin/update-announcements`：发布更新公告（管理员 + CSRF）
- `POST /api/admin/update-announcements/:id/delete`：删除更新公告（管理员 + CSRF）
- `GET /api/admin/settings`：获取设置（管理员）
- `POST /api/admin/settings`：更新设置（管理员 + CSRF，支持 `turnstileEnabled` 与 `cnyThemeEnabled`）
- `GET /api/admin/vocabulary`：敏感词列表（管理员）
- `POST /api/admin/vocabulary`：新增敏感词（管理员 + CSRF）
- `POST /api/admin/vocabulary/:id/toggle`：启用/禁用（管理员 + CSRF）
- `POST /api/admin/vocabulary/:id/delete`：删除敏感词（管理员 + CSRF）
- `POST /api/admin/vocabulary/import`：从文件导入（管理员 + CSRF）
- `GET /api/admin/vocabulary/export`：导出（管理员）

会话：

- `GET /api/admin/session`：查询当前后台登录状态（会包含 csrf token 等信息）
- `POST /api/admin/login`：登录
- `POST /api/admin/logout`：登出（管理员 + CSRF）

## 4. 权限/限流补充说明

服务端存在按行为的频控配置（例如评论频控）；封禁权限会影响发帖/评论/点赞/浏览/访问站点/聊天室等（具体以后端判断为准）。

## 5. 角色 Wiki API

### 5.1 公开接口

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

### 5.2 后台接口

以下接口均需要管理员登录，写操作需要 CSRF：

- `GET /api/admin/wiki/revisions?status=&actionType=&q=&page=&limit=`：查询 Wiki 审核记录。
- `GET /api/admin/wiki/entries?status=&q=&page=&limit=`：查询 Wiki 瓜条管理列表。
- `POST /api/admin/wiki/entries`：管理员直接创建公开瓜条。
- `POST /api/admin/wiki/revisions/:id/action`：对投稿或编辑执行 `approve` / `reject`。
- `POST /api/admin/wiki/entries/:id/edit`：管理员直接编辑当前公开瓜条。
- `POST /api/admin/wiki/entries/:id/action`：对瓜条执行 `delete` / `restore`。

审核通过规则：

- `create` 通过后创建公开瓜条，版本号为 `1`。
- `edit` 通过后覆盖当前公开瓜条，版本号 `+1`。
- `edit` 审核通过前必须校验待审记录的 `base_revision_id` 和 `base_version_number` 是否仍匹配当前公开瓜条；若瓜条已产生新版本，应拒绝直接覆盖并提示重新提交或手动合并。
- `reject` 不影响当前公开内容。

### 5.3 安全与限流

- Wiki 投稿和编辑会附带 `X-Client-Fingerprint`，并记录提交者指纹与 IP。
- Wiki 投稿和编辑执行 Turnstile 校验和封禁检查。
- 新增 `wiki` 限流配置，默认 `3 次 / 小时`。
- 后台审核、拒绝、删除、恢复、管理员创建和管理员编辑都写入 `admin_audit_logs`。
