# 03｜数据模型（SQLite）

数据库由 `server/db.js` 初始化，默认存储在 `server/data/app.db`。项目使用 `better-sqlite3`，并开启：

- `journal_mode = WAL`
- `foreign_keys = ON`

> 注意：本项目既包含“硬删除”（如少量后台词库），也包含“软删除”（帖子/评论等内容）。阅读与开发时务必区分。

## 1. 主要表概览

### 1.1 users（后台管理员）

用于后台登录：

- `username` 唯一
- `password_hash`：bcrypt hash
- `role`：默认 `admin`

### 1.2 posts（帖子）

核心字段：

- `id`：字符串主键
- `content`：正文（Markdown/富文本渲染由前端控制）
- `tags`：字符串（通常为序列化/拼接形式，具体解析以代码为准）
- `created_at`、`updated_at`
- `deleted` / `deleted_at`：软删除
- `session_id`：用于一些行为识别
- `likes_count` / `dislikes_count` / `comments_count` / `views_count`：计数冗余字段
- `ip`、`fingerprint`：风控/审计用途（字段由迁移确保存在）

### 1.3 comments（评论）

核心字段：

- `id`：字符串主键
- `post_id`：所属帖子（外键，`ON DELETE CASCADE`）
- `parent_id`：父评论（用于楼中楼树）
- `reply_to_id`：回复目标（用于“回复某人/某楼”语义）
- `content`、`author`、`created_at`
- `deleted` / `deleted_at`：软删除
- `ip`、`fingerprint`

### 1.4 reports（举报）

统一承载“帖子举报 / 评论举报”：

- `post_id` 必填
- `comment_id` 可为空（为空时通常表示帖子举报）
- `target_type`：`post` / `comment`
- `reason`、`content_snippet`、`risk_level`、`status`
- `fingerprint`、`reporter_ip`

配套防重复/风控表：

- `report_sessions`：按 `post_id + session_id` 去重
- `comment_report_sessions`：按 `comment_id + session_id` 去重
- `report_fingerprints`：按 `post_id + fingerprint` 去重
- `comment_report_fingerprints`：按 `comment_id + fingerprint` 去重

### 1.5 banned_*（封禁）

- `banned_sessions`：按 session 封禁（较少用）
- `banned_ips`：IP 封禁，可带 `expires_at`、`permissions`、`reason`
- `banned_fingerprints`：指纹封禁，可带 `expires_at`、`permissions`、`reason`

permissions 常见值（见服务端/前端映射）：

- `post`：禁止发帖
- `comment`：禁止评论
- `like`：禁止点赞
- `view`：禁止浏览
- `site`：禁止进入站点
- `chat`：禁止进入聊天室

### 1.6 notifications（通知）

以“接收者指纹”作为投递对象：

- `recipient_fingerprint`
- `type`：如 `post_comment` / `post_like` / `comment_reply`
- `post_id` / `comment_id`
- `preview`：预览文本
- `read_at`：已读时间

### 1.7 announcements（公告）

- `content`
- `updated_at`

### 1.8 app_settings（站点设置）

- `key`：主键
- `value`
- `updated_at`

目前至少包含：

- `turnstile_enabled`
- `cny_theme_enabled`

春节皮肤是否实际生效由后端按农历窗口动态计算（腊月十六至正月十五）。

### 1.9 vocabulary_words（敏感词）

- `word`：原词
- `normalized`：归一化后用于去重（唯一）
- `enabled`：启用/禁用
- `created_at` / `updated_at`

### 1.10 stats_daily / daily_visits / fingerprint_login_days（统计）

用于后台概览统计：

- `stats_daily(date, visits, posts, reports)`
- `daily_visits(date, session_id)`：访客去重
- `fingerprint_login_days(date, fingerprint)`：按指纹统计活跃天数/彩蛋

### 1.11 post_edits / admin_audit_logs（审计）

- `post_edits`：后台编辑帖子内容的前后对比与原因
- `admin_audit_logs`：后台动作审计（action、target、before_json/after_json、reason、ip、session_id）

### 1.12 chat_sessions / chat_messages / chat_mutes / chat_ban_sync（聊天室）

单聊天室实时能力的数据基座：

- `chat_sessions`
  - 一次“在线存在期”一条记录（同一指纹多端连接只算同一个在线人）
  - 关键字段：`fingerprint_hash`、`nickname`、`joined_at`、`left_at`、`connection_count_peak`
- `chat_messages`
  - 聊天消息永久保存（支持文本/图片/表情短码）
  - 关键字段：`session_id`、`fingerprint_hash`、`nickname_snapshot`、`msg_type`
  - `client_msg_id` + `fingerprint_hash` 唯一索引用于去重
  - `deleted` / `deleted_at` / `deleted_by_admin_id` 为管理删除语义
- `chat_mutes`
  - 聊天禁言状态（按指纹哈希）
  - `muted_until` 为到期时间，空值表示长期禁言
- `chat_ban_sync`
  - 聊天封禁时用于记录“指纹封禁同步到的 IP”
  - 用于解封时优先清理同一条同步 IP 封禁，避免残留

## 2. 删除语义（重要）

### 2.1 帖子

以 `deleted` 软删除为主，并维护 `deleted_at` 与计数字段；帖子相关联的一些表通过外键 `ON DELETE CASCADE` 可能在硬删时被级联清理（但“硬删帖子”是否存在取决于后台动作实现）。

### 2.2 评论

同样以 `deleted` 软删除为主。**当前后台“删除评论”是仅删除当前一条（不级联子回复）**：只把该评论 `deleted=1`，并将帖子 `comments_count` 减 1。

> 这意味着如果你希望“删除楼层时连带删除其回复”，需要在业务逻辑层自行实现级联软删（数据库层没有外键级联到子评论）。

