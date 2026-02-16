# 04｜后端 API 与权限

本章仅列出“接口清单 + 鉴权/安全要求 + 业务含义”。按你的要求：**不提供具体请求/响应示例**。

## 1. 约定与安全机制

### 1.1 统一前缀

前端统一请求 `/api/*`，由 Vite proxy（开发模式）或反向代理（生产模式）转发到后端。

### 1.2 Session（管理员登录依赖）

后端使用 cookie session。前端请求默认 `credentials: 'include'`（见 `api.ts`）。

### 1.3 CSRF（后台/举报相关）

部分敏感接口会要求 `X-CSRF-Token`（见前端 `api.ts` 的 `needsAdminCsrf()` 判断）。

### 1.4 指纹（X-Client-Fingerprint）

后端依赖指纹做频控/风控与通知投递。前端会按路径选择性附带 `X-Client-Fingerprint`（见 `api.ts` 的 `shouldAttachFingerprint()`）。

## 2. 公共 API（无需管理员）

以下路由来自 `server/index.js`：

- `GET /api/health`：健康检查
- `GET /api/access`：访问控制状态（是否被封禁、过期时间等）
- `GET /api/settings`：公开设置（`turnstileEnabled`、`cnyThemeEnabled`、`cnyThemeAutoActive`、`cnyThemeActive`）
- `GET /api/announcement`：公告内容

在线/通知/彩蛋：

- `POST /api/online/heartbeat`：在线心跳
- `GET /api/notifications`：拉取通知列表
- `POST /api/notifications/read`：标记通知已读
- `GET /api/easter-eggs/streak7`：查询“连续登录 7 天”状态
- `POST /api/easter-eggs/streak7/seen`：标记彩蛋已看过

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

## 3. 管理员 API（需登录）

管理员鉴权主要通过 `requireAdmin` 中间件，常见敏感操作还会额外要求 `requireAdminCsrf`。

举报处置：

- `GET /api/reports`：获取待处理举报（管理员）
- `POST /api/reports/:id/action`：处理举报（ignore/delete/ban 等）（管理员 + CSRF）
- `POST /api/admin/reports/batch`：批量处理举报（管理员 + CSRF）

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

审计/统计：

- `GET /api/admin/audit-logs`：后台操作审计日志（管理员）
- `GET /api/admin/stats`：统计概览（管理员）

公告/设置/敏感词：

- `GET /api/admin/announcement`：获取后台公告（管理员）
- `POST /api/admin/announcement`：更新公告（管理员 + CSRF）
- `POST /api/admin/announcement/clear`：清空公告（管理员 + CSRF）
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

服务端存在按行为的频控配置（例如评论频控）；封禁权限会影响发帖/评论/点赞/浏览/访问站点等（具体以后端判断为准）。

