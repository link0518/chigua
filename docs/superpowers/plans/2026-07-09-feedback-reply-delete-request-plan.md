# 留言回复通知与帖子删除申请审核实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 实现管理员留言回复通知，以及发帖人删除申请与内容审核队列。

**架构：** 后端新增 `feedback_replies` 与 `post_delete_requests` 数据表，公共帖子接口负责作者申请删除，后台内容审核接口负责查询与审核。前端复用现有通知、后台导航、操作抽屉和帖子详情结构，新增最小入口与队列视图。

**技术栈：** React 19、TypeScript、Express、better-sqlite3、node:test、Vite。

---

## 文件结构

* 修改 `server/db.js`：创建新表、迁移列和索引。
* 修改 `server/routes/admin/feedback-routes.js`：返回回复历史并新增管理员回复接口。
* 修改 `server/routes/public/posts-routes.js`：返回作者状态并新增删除申请提交接口。
* 创建 `server/routes/admin/post-delete-requests-routes.js`：后台内容审核删除申请队列与审核动作。
* 修改 `server/index.js`：注册后台删除申请路由并注入通知能力。
* 修改 `server/reset-data.js`：重置时清理新表。
* 新增/修改 `server/tests/*`：先验证留言回复、删除申请提交、审核动作。
* 修改 `types.ts`：扩展 `Post`、`NotificationItem`、`FeedbackMessage`，新增 `PostDeleteRequest` 类型。
* 修改 `api.ts`：新增删除申请、留言回复、后台删除申请 API。
* 修改 `App.tsx`：新增通知类型文案和图标，完整展示回复/审核结果。
* 修改 `components/HomeView.tsx`：发帖人详情小删除按钮、原因弹窗、审核中状态。
* 修改 `features/admin/views/AdminFeedbackView.tsx`：回复按钮与回复历史展示。
* 修改 `components/AdminDashboard.tsx`：接入反馈回复处理、删除申请队列状态、导航、审核抽屉。
* 新增 `features/admin/views/AdminPostDeleteRequestsView.tsx`：内容审核删除申请队列视图。
* 修改 `features/admin/views/AdminOverviewView.tsx`：待办统计加入删除申请。
* 修改 `docs/03-数据模型(SQLite).md`、`docs/04-后端API与权限.md`、`docs/05-后台管理功能.md`：同步新行为。

## 任务 1：后端留言回复

- [x] 编写失败测试：`server/tests/admin-feedback-routes.test.js`，验证管理员回复会写入 `feedback_replies`、返回回复历史、创建 `feedback_reply` 通知。
- [x] 运行：`node --test server/tests/admin-feedback-routes.test.js`，预期因接口不存在失败。
- [x] 修改 `server/db.js` 和 `server/routes/admin/feedback-routes.js`，实现 `feedback_replies` 与 `POST /api/admin/feedback/:id/replies`。
- [x] 运行同一测试，预期通过。

## 任务 2：后端删除申请提交与审核

- [x] 编写失败测试：`server/tests/post-delete-requests-routes.test.js`，验证作者可提交、非作者禁止、重复 pending 失败、审核通过软删除并通知、审核驳回保持公开并通知。
- [x] 运行：`node --test server/tests/post-delete-requests-routes.test.js`，预期因接口不存在失败。
- [x] 修改 `server/db.js`、`server/routes/public/posts-routes.js`，创建 `post_delete_requests` 并实现 `POST /api/posts/:id/delete-requests` 与 `GET /api/posts/:id` 作者状态。
- [x] 创建 `server/routes/admin/post-delete-requests-routes.js` 并在 `server/index.js` 注册后台查询与审核接口。
- [x] 运行同一测试，预期通过。

## 任务 3：前端类型、API 与通知

- [x] 修改 `types.ts`、`api.ts`、`App.tsx`，扩展通知类型、前端 API 和展示文案。
- [x] 运行：`npx tsc --noEmit`，预期没有新增类型错误。

## 任务 4：前台帖子详情删除申请

- [x] 修改 `components/HomeView.tsx`：仅作者可见小删除按钮；点击打开原因弹窗；提交后显示审核中状态。
- [x] 运行：`npx tsc --noEmit`，预期没有新增类型错误。

## 任务 5：后台留言回复与删除申请队列

- [x] 修改 `features/admin/views/AdminFeedbackView.tsx` 和 `components/AdminDashboard.tsx`，加入回复历史、回复抽屉和提交处理。
- [x] 新增 `features/admin/views/AdminPostDeleteRequestsView.tsx`，并在 `components/AdminDashboard.tsx` 加入删除申请导航、待办计数、待处理/已处理切换和审核抽屉。
- [x] 修改 `features/admin/views/AdminOverviewView.tsx`，今日待办加入删除申请。
- [x] 运行：`npx tsc --noEmit`，预期没有新增类型错误。

## 任务 6：文档与全量验证

- [x] 更新 `docs/03-数据模型(SQLite).md`、`docs/04-后端API与权限.md`、`docs/05-后台管理功能.md`。
- [x] 运行：`npm run test:server`，预期全部服务端测试通过。
- [x] 运行：`npx tsc --noEmit`，预期类型检查通过。
- [x] 运行：`npm run build`，预期生产构建通过。
- [x] 检查 `git diff`，确认未回滚或覆盖无关改动。
