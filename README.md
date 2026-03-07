# 吃瓜社（GossipSketch）

一个以“匿名吃瓜 / 发帖 / 评论 / 举报 / 在线聊天室 / 后台审核”为核心的轻量社区项目：前端使用 Vite + React + TypeScript，后端使用 Express + SQLite（better-sqlite3），同仓库内同时提供前端与后端。

> 说明：仓库历史 `README.md` 曾出现编码异常（非 UTF-8）。当前版本为 UTF-8 文档，方便后续维护与检索。

## 快速开始

### 1）环境要求

- Node.js 18+（建议 18/20/22 LTS）
- npm

### 2）安装依赖

```bash
npm install
```

### 3）配置环境变量（本地开发推荐）

复制并创建 `.env.local`：

```bash
copy .env.example .env.local
```

关键字段（见 `.env.example`）：

- `PORT`：后端 API 端口（默认 `4395`）
- `VITE_PORT`：前端 dev server 端口（默认 `4396`，见 `vite.config.ts`）
- `SESSION_SECRET`：后台会话密钥（未配置会导致后台禁用）
- `ADMIN_USERNAME` / `ADMIN_PASSWORD`：后台账号密码（未配置会导致后台禁用）
- `VITE_TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY`：Cloudflare Turnstile（发帖/评论相关）
- `FINGERPRINT_SALT`：指纹盐（不填会回退到 `SESSION_SECRET` 或内置默认值）

### 4）初始化数据（可选）

```bash
npm run init-data
```

### 5）启动开发环境

分开启动：

```bash
npm run server   # 后端 API（默认 4395）
npm run dev      # 前端（默认 4396）
```

一起启动：

```bash
npm run dev:full
```

## 常用命令

- `npm run dev`：启动前端（Vite）
- `npm run server`：启动后端（Express）
- `npm run dev:full`：前后端并行启动
- `npm run build`：构建前端产物到 `dist/`
- `npm run preview`：本地预览 `dist/`
- `npm run init-data`：初始化示例数据（幂等）
- `npm run reset-data`：重置测试数据（通常保留管理员，再 init）
- `npm run seo:generate`：生成 SEO 资源（见 `server/seo-generate.js`）
- `npm run perf:budget`：性能预算校验脚本（Lighthouse）

## 项目结构（高层）

- `index.html`：Vite HTML 壳
- `index.tsx`：React 入口，挂载 `AppProvider`
- `App.tsx`：顶层布局与“轻路由”（基于 `window.location.pathname`）
- `api.ts`：前端 API 封装（统一前缀 `/api`、指纹与 CSRF 处理）
- `components/`：页面与通用组件（含后台 UI：`AdminGate`/`AdminDashboard`）
- `components/ChatRoomView.tsx`：匿名聊天室前端页面（单聊天室入口）
- `store/AppContext.tsx`：全局状态与业务动作（调用 `api.ts`）
- `types.ts`：共享类型定义
- `server/`：后端（路由、鉴权、SQLite、管理逻辑，含 `identity-service.js` 身份归一与 `chat-realtime-service.js` WebSocket 实时服务）
- `server/data/app.db`：SQLite 数据库文件（运行后生成）
- `Vocabulary/`：敏感词库文本文件（服务端加载）
- `scripts/`：构建/性能等脚本
- `dist/`：前端构建产物（不要手改）

## 身份与风控（重要）

- 后端会为访客补发 `HttpOnly Cookie` `gs_client_id_v2`，作为相对稳定的客户端身份。
- 前端对发帖、评论、点赞、举报、聊天室等风控敏感接口，仍会按需附带 `X-Client-Fingerprint`。
- 服务端会把 Cookie 身份与 legacy 指纹关联到 `identity_aliases`，并在封禁判断、通知读取、收藏/点赞状态、连续登录彩蛋、聊天室身份识别等场景按“身份集合”聚合，而不是只看单次指纹。

## 后台入口

- 路径：`/tiancai`
- 条件：必须配置并生效 `SESSION_SECRET` + `ADMIN_USERNAME` + `ADMIN_PASSWORD`（否则后台会显示“未启用”）

## 文档入口（必读）

本仓库采用 `README.md + docs/` 的文档拆分。首次接手建议按顺序阅读：

1. `docs/01-快速上手.md`
2. `docs/02-架构总览.md`
3. `docs/03-数据模型(SQLite).md`
4. `docs/04-后端API与权限.md`
5. `docs/05-后台管理功能.md`
6. `docs/06-部署与运维.md`
7. `docs/07-变更记录与文档更新流程.md`
