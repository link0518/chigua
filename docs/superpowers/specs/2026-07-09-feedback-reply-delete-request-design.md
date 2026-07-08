# 留言回复通知与帖子删除申请审核设计规格

日期：2026-07-09

## 目标

补齐后台互动闭环：

* 管理员可以在留言管理中回复用户留言，用户在前台通知中直接看到完整回复。
* 发帖人可以对自己的帖子申请删除，填写原因后进入管理员审核。
* 管理员在内容审核中处理删除申请，通过后软删除帖子，驳回后帖子继续公开，并通知申请人。

## 范围

本次设计覆盖：

* 留言回复记录、后台回复入口、回复历史展示、回复通知。
* 帖子删除申请记录、发帖人申请入口、申请中状态、内容审核队列、审核结果通知。
* 相关后端接口、权限、通知类型、测试与文档更新。

不纳入本次 MVP：

* 邮件、短信、系统 Push。
* 用户侧“我的留言”或“我的申请记录”页面。
* 多管理员协同审批、工单流转、导出。
* 注册账号体系；继续沿用现有 fingerprint / identity_aliases 识别匿名用户身份。
* 删除申请高级筛选。

## 决策

采用独立记录表方案：

* 新增 `feedback_replies` 保存管理员回复历史。
* 新增 `post_delete_requests` 保存帖子删除申请与审核历史。
* 复用现有 `notifications` 投递用户通知。
* 复用现有 `admin_audit_logs` 记录后台动作。

原因：

* 比直接在 `feedback_messages` / `posts` 上加状态字段更清晰。
* 支持同一留言多次回复、删除申请已处理历史回看。
* 不把删除申请混入举报或普通反馈，语义边界更稳定。

## 数据模型

### feedback_replies

用于保存管理员对留言的回复历史。

字段建议：

* `id TEXT PRIMARY KEY`
* `feedback_id TEXT NOT NULL`
* `content TEXT NOT NULL`
* `admin_id INTEGER`
* `admin_username TEXT`
* `created_at INTEGER NOT NULL`

索引：

* `idx_feedback_replies_feedback_created_at(feedback_id, created_at DESC)`

规则：

* 同一 `feedback_id` 可以有多条回复。
* 回复不覆盖旧回复。
* 若留言缺少可投递通知的 `fingerprint`，后端应拒绝回复并返回明确错误。

### post_delete_requests

用于保存发帖人提交的删除申请与管理员审核结果。

字段建议：

* `id TEXT PRIMARY KEY`
* `post_id TEXT NOT NULL`
* `requester_fingerprint TEXT NOT NULL`
* `requester_ip TEXT`
* `reason TEXT NOT NULL`
* `status TEXT NOT NULL DEFAULT 'pending'`
* `created_at INTEGER NOT NULL`
* `reviewed_at INTEGER`
* `reviewed_by INTEGER`
* `reviewed_by_username TEXT`
* `review_reason TEXT`

索引：

* `idx_post_delete_requests_status_created_at(status, created_at DESC)`
* `idx_post_delete_requests_post_status(post_id, status)`
* `idx_post_delete_requests_requester_created_at(requester_fingerprint, created_at DESC)`

规则：

* `status` 只允许 `pending`、`approved`、`rejected`。
* 同一帖子同一时间只允许一条 `pending` 删除申请。
* 已驳回后可以再次提交新申请；仍必须填写原因。
* 帖子已删除或已隐藏时，不允许提交新的删除申请。
* 审核通过后更新 `posts.deleted = 1`、`posts.deleted_at = now`，不物理删除。

## 后端接口

### 留言回复

新增：

* `POST /api/admin/feedback/:id/replies`
  * 权限：`feedback:manage` + CSRF。
  * 请求体：`{ content: string }`。
  * 校验：内容必填，最长 1000 字。
  * 行为：写入 `feedback_replies`，写审计日志，创建 `feedback_reply` 通知。

调整：

* `GET /api/admin/feedback`
  * 返回每条留言的完整回复历史，按 `created_at ASC` 展示，便于管理员按时间阅读上下文。
  * MVP 不新增单独的回复分页接口。

### 删除申请

新增：

* `POST /api/posts/:id/delete-requests`
  * 权限：普通用户身份，需 `requireFingerprint`。
  * 请求体：`{ reason: string }`。
  * 校验：必须是帖子发布者本人；原因必填；帖子未删除、未隐藏；没有待审核申请。
  * 行为：写入 `post_delete_requests`，帖子继续公开。

* `GET /api/admin/post-delete-requests?status=pending|processed&page=&limit=`
  * 权限：`content_review:read`。
  * 返回：申请、帖子摘要、申请人身份、状态、审核信息。

* `POST /api/admin/post-delete-requests/:id/action`
  * 权限：`content_review:manage` + CSRF。
  * 请求体：`{ action: 'approve' | 'reject', reason?: string }`。
  * 行为：
    * `approve`：将申请置为 `approved`，软删除帖子，写审计日志，通知申请人。
    * `reject`：将申请置为 `rejected`，帖子保持公开，写审计日志，通知申请人。
  * 审核说明可选；为空时通知使用默认文案。

调整：

* `GET /api/posts/:id`
  * 对帖子作者本人额外返回：
    * `viewerIsAuthor: boolean`
    * `viewerDeleteRequestStatus: 'pending' | null`
  * 非作者不返回可操作状态，避免暴露无关信息。

## 通知设计

新增通知类型：

* `feedback_reply`
* `post_delete_request_approved`
* `post_delete_request_rejected`

展示规则：

* `feedback_reply`：通知弹层直接显示完整管理员回复，不跳转。
* `post_delete_request_approved`：通知弹层展示默认结果文案和可选审核说明；不跳转已删除帖子。
* `post_delete_request_rejected`：通知弹层展示默认结果文案和可选审核说明；可携带 `postId` 允许返回帖子。

默认文案：

* 留言回复：`管理员回复了你的留言`
* 删除申请通过：`你的帖子删除申请已通过`
* 删除申请驳回：`你的帖子删除申请已驳回`

前端 `NotificationItem['type']` 需要同步扩展。

## 前端设计

### 留言管理

在现有留言卡片中新增“回复”操作，并展示回复历史。

```text
留言管理
┌────────────────────────────────┐
│ 留言内容                        │
│ 联系方式 / 身份 / 时间           │
│                                │
│ 回复历史                        │
│ - 管理员A：回复内容              │
│ - 管理员B：补充说明              │
│                                │
│ [标记已读] [回复] [封禁] [删除]  │
└────────────────────────────────┘
```

交互：

* 点击“回复”打开右侧回复抽屉。
* 回复内容必填。
* 提交后刷新留言列表和回复历史。
* 同一留言允许多次回复。

### 帖子详情删除申请入口

只在帖子详情/展开态显示，仅发帖人本人可见，入口是一个小删除按钮。

```text
帖子详情/展开态
┌────────────────────┐
│ 正文内容...         │
│                    │
│ [评论] [分享] [删] │
└────────────────────┘
```

交互：

* 点击小删除按钮后弹出删除申请原因弹窗。
* 原因必填。
* 提交成功后显示“删除申请审核中”。
* 待审核期间禁止重复提交。
* 审核期间帖子继续在首页、搜索、详情中正常公开。

### 内容审核删除申请队列

在内容审核中新增独立队列，和举报、隐藏内容、谣言审核并列。

```text
内容审核
[举报处理] [隐藏内容] [谣言审核] [删除申请]

删除申请
[待处理] [已处理]

┌────────────────────────────────┐
│ 帖子摘要                        │
│ 申请原因                        │
│ 申请人身份 / 时间                │
│                                │
│ [通过删除] [驳回]                │
└────────────────────────────────┘
```

规则：

* 待处理视图展示 `pending`。
* 已处理视图展示 `approved` 和 `rejected`。
* 通过和驳回都可填写处理说明，但不强制。
* 通过后帖子软删除；驳回后帖子保持公开。

## 权限与审计

权限：

* 留言回复：`feedback:manage`。
* 删除申请查看：`content_review:read`。
* 删除申请审核：`content_review:manage`。

审计：

* 管理员回复留言写入 `admin_audit_logs`，action 为 `feedback_reply`。
* 删除申请通过写入 `admin_audit_logs`，action 为 `post_delete_request_approve`，审计内容包含帖子从未删除到已删除的状态变化。
* 删除申请驳回写入 `admin_audit_logs`，action 为 `post_delete_request_reject`。

## 错误处理

用户提交删除申请：

* 非发帖人：`403`，提示“只有发帖人可以申请删除”。
* 原因为空：`400`，提示“请填写删除原因”。
* 帖子不存在、已删除或已隐藏：`404`，提示“帖子不存在或当前不可申请删除”。
* 已有待审核申请：`409`，提示“删除申请正在审核中”。

管理员回复留言：

* 回复为空：`400`。
* 留言不存在：`404`。
* 留言缺少可通知身份：`400`，提示“该留言缺少用户身份，无法发送站内回复”。

管理员审核删除申请：

* 申请不存在：`404`。
* 申请不是 `pending`：`409`。
* 审核通过时帖子已删除：返回 `409`，提示“帖子已被处理，无法重复删除”。

## 测试计划

后端测试：

* 管理员回复留言会写入 `feedback_replies` 并创建 `feedback_reply` 通知。
* 同一留言多次回复会保留多条历史。
* 无身份留言回复失败。
* 发帖人可以提交删除申请，非发帖人不能提交。
* 空原因、已删除帖子、已有 pending 申请会失败。
* 审核通过会更新申请状态、软删除帖子、写通知和审计。
* 审核驳回会更新申请状态、保持帖子公开、写通知和审计。
* 删除申请队列能按待处理和已处理查询。

前端验证：

* 留言管理中可回复并看到回复历史。
* 通知弹层能完整展示管理员回复。
* 只有发帖人在帖子详情中看到小删除按钮。
* 提交后显示“删除申请审核中”。
* 内容审核删除申请队列支持待处理和已处理切换。

质量检查：

* `npx tsc --noEmit`
* `npm run test:server`
* `npm run build`

## 文档更新

实现后同步更新：

* `docs/03-数据模型(SQLite).md`
* `docs/04-后端API与权限.md`
* `docs/05-后台管理功能.md`

## 验收标准

* 管理员可以在留言管理中多次回复同一条留言。
* 用户能在通知弹层中看到每次管理员回复的完整内容。
* 只有发帖人本人能在帖子详情/展开态看到小删除按钮。
* 发帖人提交删除申请必须填写原因。
* 删除申请待审核期间帖子继续公开展示。
* 发帖人提交后能看到“删除申请审核中”，且不能重复提交。
* 管理员能在内容审核独立队列中查看待处理删除申请。
* 管理员能在同一队列中查看已处理历史。
* 审核通过后帖子软删除，并通知申请人。
* 审核驳回后帖子保持公开，并通知申请人。
* 审核说明为空时不阻塞操作，通知使用默认文案。
