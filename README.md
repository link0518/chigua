# JX3 瓜田（GossipSketch）

JX3 瓜田是一个前后端同仓的匿名社区应用，核心能力包括匿名投稿、评论互动、热门榜单、搜索收藏、举报治理、后台审核、角色 Wiki 和基础运维脚本。

项目当前不是纯前端 Demo：前端由 Vite + React + TypeScript 构建，后端由 Express + SQLite 提供 API、会话、风控、审核和数据持久化。第一次接手时，请把本 README 当作入口地图，把 `docs/` 当作细节手册。

## 功能概览

- 匿名帖子：投稿、图片上传、Markdown 编辑、标签、点赞/点踩、收藏、浏览计数。
- 评论互动：楼中楼回复、评论点赞、直达评论链接、帖子作者身份提示。
- 内容发现：首页单帖/列表浏览、热门榜单、精华频道、关键词搜索、标签搜索、我的收藏。
- 站点通知：公告、更新公告、站内提醒、连续访问彩蛋。
- 举报治理：帖子/评论举报、谣言举报、自动隐藏、封禁与限流。
- 后台管理：举报处理、精华审核、帖子与评论治理、反馈、封禁、公告、系统设置、敏感词、审计日志、管理员权限。
- 角色 Wiki：公开角色瓜条、投稿与编辑审核、版本历史、独立 Nordic 风格页面。
- 运维支持：初始化数据、SEO 生成、性能预算检查、部署与更新脚本。

## 技术栈

- 前端：Vite、React 19、TypeScript、Tailwind CSS v4、lucide-react、CodeMirror、Kumo UI。
- 后端：Express、better-sqlite3、express-session、better-sqlite3-session-store。
- 数据：SQLite，运行后默认写入 `server/data/app.db`。
- 构建与脚本：npm scripts、Vite build、Node.js 内置测试运行器、Lighthouse CI 辅助脚本。

## 快速开始

### 1. 环境要求

- Node.js 18+，建议使用 20/22 LTS。
- npm。

### 2. 安装依赖

```bash
npm install
```

### 3. 配置环境变量

复制示例文件：

```bash
copy .env.example .env.local
```

常用变量：

| 变量 | 用途 |
| --- | --- |
| `PORT` | 后端 API 端口，默认 `4395`。 |
| `VITE_PORT` | 前端 Vite 端口，默认 `4396`；示例文件未写入，但 `vite.config.ts` 支持。 |
| `SESSION_SECRET` | 后台会话密钥；缺失时会生成临时密钥，后台会被禁用。 |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | 后台超级管理员账号；与 `SESSION_SECRET` 一起决定后台是否启用。 |
| `VITE_TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile 站点与服务端校验密钥。 |
| `IMGBED_BASE_URL` / `IMGBED_TOKEN` | 服务端图片上传代理配置；缺失时图片上传不可用。 |
| `WIKI_ATTACHMENT_ALLOWED_ORIGINS` | 可选，逗号分隔的额外 Wiki 附件图床来源（历史图床或独立 CDN）。默认允许 `https://img.zsix.de`、`https://ibed.933211.xyz`，并自动允许 `IMGBED_BASE_URL` 的来源；外部来源必须使用 HTTPS，本地回环 HTTP 可用于开发。 |
| `FINGERPRINT_SALT` | 客户端指纹哈希盐；缺失时回退到 `SESSION_SECRET` 或内置默认值。 |
| `SITE_URL` | 生产站点地址，用于 SEO、分享链接与 sitemap；请在本地或部署环境中配置真实域名，不要提交私有站点信息。 |

### 4. 初始化数据

```bash
npm run init-data
```

如需重置本地测试数据：

```bash
npm run reset-data
npm run init-data
```

### 5. 启动开发环境

分开启动，适合调试：

```bash
npm run server
npm run dev
```

一起启动，适合日常开发：

```bash
npm run dev:full
```

默认访问地址：

- 前端：`http://localhost:4396`
- 后端健康检查：`http://localhost:4395/api/health`
- 后台入口：`http://localhost:4396/tiancai`

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 启动 Vite 前端开发服务器。 |
| `npm run server` | 启动 Express 后端服务。 |
| `npm run dev:full` | 同时启动前端和后端。 |
| `npm run init-data` | 初始化示例/基础数据，脚本设计为可重复执行。 |
| `npm run reset-data` | 重置本地测试数据。 |
| `npm run build` | 生成前端生产构建到 `dist/`。 |
| `npm run preview` | 本地预览 `dist/`。 |
| `npm run seo:generate` | 生成 SEO 相关资源。 |
| `npm run perf:budget` | 执行 Lighthouse 性能预算检查。 |
| `npm run test:server` | 运行 `server/tests/*.test.js` 服务端测试。 |
| `npx tsc --noEmit` | 执行 TypeScript 静态检查。 |

## 访问入口

| 路径 | 说明 |
| --- | --- |
| `/` | 主站首页，包含最新、热门、投稿等主流程入口。 |
| `/post/:id` | 单帖分享与详情聚焦页。 |
| `/feed` | 热门榜单，支持今日、近 7 天和历史排行。 |
| `/search` | 关键词和标签搜索。 |
| `/featured` | 当前公开精华帖子。 |
| `/favorites` | 当前访客的收藏列表。 |
| `/wiki` | 角色 Wiki 画廊。 |
| `/wiki/:slug` | 角色 Wiki 详情页。 |
| `/tiancai` | 后台管理入口。 |

前端请求统一走 `/api/*`。开发环境由 Vite proxy 转发到后端端口；生产环境需要反向代理保持同样的路径约定。

## 项目结构

```text
.
├── App.tsx                       # 顶层应用壳、导航、站点级弹窗与路由状态
├── api.ts                        # 前端 API 封装、CSRF、指纹和 cookie 请求配置
├── components/                   # 主站、投稿、评论、Wiki、后台等 React 组件
├── features/                     # 逐步拆出的前端领域模块
├── store/AppContext.tsx          # 全局状态、业务动作和数据缓存
├── server/                       # Express 后端、路由、服务、SQLite 初始化和测试
├── Vocabulary/                   # 敏感词库文本文件
├── public/                       # favicon、robots、sitemap、表情包等静态资源
├── scripts/                      # 开发、测试、SEO、性能预算辅助脚本
├── docs/                         # 详细项目文档
├── jx3wiki/                      # Wiki 视觉参考与生成资产
└── dist/                         # 前端构建产物，不手动编辑
```

后端路由按公共接口与后台接口拆分在 `server/routes/public/` 和 `server/routes/admin/`。较复杂的业务逻辑优先放在 `server/services/` 或 `server/repositories/`，不要继续把新能力全部堆进入口文件。

## 安全与治理要点

- 后台启用必须同时配置 `SESSION_SECRET`、`ADMIN_USERNAME` 和 `ADMIN_PASSWORD`。
- 管理员分为 `super_admin` 与普通 `admin`，普通管理员按模块拥有 `read` 或 `manage` 权限。
- 后端权限中间件是安全边界，前端隐藏菜单或按钮只用于体验优化。
- 敏感写操作依赖 cookie session 与 `X-CSRF-Token`。
- 访客身份由 `HttpOnly Cookie` `gs_client_id_v2` 和按需附带的 `X-Client-Fingerprint` 共同归一，用于封禁、举报去重、通知和互动状态。
- 图片上传走服务端代理，前端不应暴露图床 token。
- Turnstile、限流、敏感词、自动隐藏和封禁共同组成内容治理链路。

## 文档索引

建议按顺序阅读：

1. `docs/01-快速上手.md`
2. `docs/02-架构总览.md`
3. `docs/03-数据模型(SQLite).md`
4. `docs/04-后端API与权限.md`
5. `docs/05-后台管理功能.md`
6. `docs/06-部署与运维.md`
7. `docs/07-变更记录与文档更新流程.md`
8. `docs/09-帖子标签功能.md`
9. `docs/10-角色Wiki功能.md`
10. `docs/11-代码审查与重构建议.md`

README 只维护高层事实和上手路径；接口细节、数据表、后台规则和部署细节以 `docs/` 为准。

## 部署提示

生产构建：

```bash
npm run build
```

部署时通常需要：

- 常驻后端 API 进程，例如 pm2 或 systemd。
- 静态服务承载 `dist/`。
- 反向代理将 `/api/*` 转发到后端。
- 根据 SEO/分享需求，将 `/post/*`、`/robots.txt`、`/sitemap.xml` 等路径按 `docs/06-部署与运维.md` 的说明处理。
- 定期备份 `server/data/app.db`。

仓库提供 `deploy.sh`、`update.sh`、`update-force.sh` 作为 Debian VPS + pm2 + Caddy 的参考脚本。执行会影响部署目录和进程状态，运行前请先阅读脚本内容。

## 开发约定

- 文档、注释和面向项目维护者的说明默认使用中文。
- TypeScript/React 文件保持现有 2 空格缩进、分号、单引号风格。
- 新增功能优先复用现有 `api.ts`、`AppContext`、路由和服务层模式。
- 不手动编辑 `dist/`、`server/data/app.db`、日志文件和本地环境文件。
- 修改跨前后端的数据流时，至少运行 `npx tsc --noEmit`、`npm run test:server` 和 `npm run build` 中与改动相关的检查。
