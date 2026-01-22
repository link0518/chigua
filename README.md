# 吃瓜社（GossipSketch）

## 项目简介
匿名吃瓜社区，支持投稿、评论、举报与管理员后台审核。

默认端口：
- 后端 API：`4395`
- 前端：`4396`

后台入口：
- 前端地址 `/tiancai`（仅管理员可登录）

## 目录结构
- `App.tsx` / `components/`：前端页面与组件
- `store/`：前端状态与 API 调用
- `server/`：后端接口、SQLite、管理逻辑
- `Vocabulary/`：敏感词库（`.txt`）
- `public/`：静态资源（站点图标）
- `server/data/app.db`：SQLite 数据库

## 环境要求
- Node.js 18+
- npm

## 环境变量（可选）
创建 `.env.local`：
- `PORT`：API 端口（默认 `4395`）
- `SESSION_SECRET`：会话密钥
- `ADMIN_USERNAME` / `ADMIN_PASSWORD`：初始化管理员账号密码

## 安装依赖
```bash
npm install
```

## 初始化数据（幂等）
```bash
npm run init-data
```
说明：
- 不会覆盖已有管理员
- 使用固定 ID 与 `INSERT OR IGNORE`，重复执行不会插入重复数据

## 本地开发
```bash
npm run server   # API 服务 4395
npm run dev      # 前端服务 4396
```
同时启动：
```bash
npm run dev:full
```

## 生产构建
```bash
npm run build
```

## Debian VPS + PM2 部署
启动后端：
```bash
pm2 start npm --name chigua-api -- run server
```

启动前端（静态）：
```bash
pm2 serve dist 4396 --spa --name chigua-web
```

## 反向代理（必需）
前端请求 `/api`，需反代到 `4395`。

Nginx 示例：
```nginx
location /api/ {
  proxy_pass http://127.0.0.1:4395/;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
}
```

## 敏感词库
读取 `Vocabulary/*.txt`，热加载约 5 秒生效一次：
- 忽略大小写
- 全/半角归一
- 去空白与常见标点
- 子串匹配

## 备份与恢复
- 备份：复制 `server/data/app.db`
- 恢复：替换 `server/data/app.db` 并重启服务

## 默认管理员
- 账号：`tiancai`
- 密码：``
- 密码使用 bcrypt 加密存储
