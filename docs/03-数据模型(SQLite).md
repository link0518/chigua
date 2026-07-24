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
- `author_frame_id`：发帖时快照的昵称框 id（仅新帖写入；不随之后装备变更回溯）
- `author_name_style_id`：发帖时快照的炫彩昵称样式 id（仅新帖写入）

### 1.2.1 user_cosmetics（访客装扮/瓜子）

按客户端身份键（通常为 fingerprint）存储：

- `identity_key`：主键
- `coins`：瓜子余额
- `owned_frames_json`：已拥有框 id 列表
- `equipped_frame_id`：当前装备的框 id
- `owned_name_styles_json`：已拥有炫彩昵称 id 列表
- `equipped_name_style_id`：当前装备的炫彩昵称 id
- `last_daily_claim_date`：每日瓜子领取日期键

### 1.2.2 nickname_frames（头像框商品与渲染包）

后台可管理的头像框表（`server/frame-service.js` 初始化并 seed 内置三框）：

- `id`：稳定主键（发帖快照与库存引用；禁止改 id）
- `name` / `price` / `rarity` / `status` / `sort` / `grant_on_register`
- `status`：`on_sale`（在售）/ `off_sale`（下架不可再买，已拥有可继续装备）/ `hidden`（隐藏，不可装备，历史展示降级）
- `package_json`：Frame Package schemaVersion 2 原文（frame + render + preview）
- `theme_css`：消毒后的 CSS（供 Shadow DOM 渲染）
- `package_revision`：导入更新时递增

渲染约定：固定插槽 DOM（`.fg-root` / `.fg-shell` / `.fg-avatar` / `.fg-name` 等）+ 受控 CSS 动效；禁止 JS。

### 1.2.3 name_styles（炫彩昵称商品）

- `id`：稳定主键（快照引用）
- `name` / `price` / `rarity` / `status` / `sort` / `description`
- `color_r` / `color_g` / `color_b`：RGB 0～255，前台按色渲染流光昵称
- seed：`vip-red`（红色昵称，207,19,34）

### 1.3 comments（评论）

核心字段：

- `id`：字符串主键
- `post_id`：所属帖子（外键，`ON DELETE CASCADE`）
- `parent_id`：父评论（用于楼中楼树）
- `reply_to_id`：回复目标（用于“回复某人/某楼”语义）
- `content`、`author`、`created_at`
- `deleted` / `deleted_at`：软删除
- `ip`、`fingerprint`
- `author_name_style_id`：评论时快照的炫彩昵称样式 id（回复/楼中楼同样写入）

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

### 1.4.1 post_delete_requests（帖子删除申请）

用于保存发帖人提交的删帖申请和管理员审核结果：

- `post_id`：申请删除的帖子
- `requester_fingerprint` / `requester_ip`：申请人身份
- `reason`：申请原因，必填
- `status`：`pending` / `approved` / `rejected`
- `created_at`：申请时间
- `reviewed_at` / `reviewed_by` / `reviewed_by_username`：审核信息
- `review_reason`：管理员处理说明，可为空

关键规则：

- 同一帖子同一时间只允许一条 `pending` 申请。
- `pending` 期间帖子继续公开展示。
- 审核通过后更新 `posts.deleted = 1` 和 `posts.deleted_at`，不物理删除帖子。

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
- `recruit`：禁止发布或申请招募
- `chat`：禁止发送招募密聊或交换联系方式

招募举报触发的封禁默认只写入 `recruit` 与 `chat` 权限；`site` 必须由管理员明确选择，不能由招募封禁默认扩大为整站封禁。

### 1.6 identity_aliases（身份映射）

用于把较稳定的 Cookie 身份与 legacy 指纹绑定起来：

- `canonical_hash`：基于 `gs_client_id_v2` 计算出的 canonical 身份哈希
- `legacy_fingerprint_hash`：基于 `X-Client-Fingerprint` / 历史指纹计算出的 legacy 哈希
- `source`：映射来源（默认 `request`）
- `first_seen_at` / `last_seen_at`
- `(canonical_hash, legacy_fingerprint_hash)` 唯一

典型用途：

- 请求进入后构造 `lookupHashes`，让同一用户在指纹变化后仍能命中旧数据
- 让封禁判断、通知读取、收藏/点赞状态、举报去重、连续登录彩蛋按“身份集合”聚合

### 1.7 notifications（通知）

以“接收者指纹”作为投递对象：

- `recipient_fingerprint`
- `type`：如 `post_comment` / `post_like` / `comment_reply`
- `post_id` / `comment_id`
- `preview`：预览文本
- `read_at`：已读时间

补充说明：

- 通知写入时仍落单个 `recipient_fingerprint`
- 读取/已读时会结合 `identity_aliases` 聚合同一身份下的多个哈希
- 管理员留言回复和删帖申请审核会复用通知表，类型包括 `feedback_reply`、`post_delete_request_approved`、`post_delete_request_rejected`

### 1.7.1 feedback_messages / feedback_replies（留言与回复）

`feedback_messages` 保存前台留言内容、联系方式、提交身份和已读状态。

`feedback_replies` 保存管理员对留言的回复历史：

- `feedback_id`：关联留言
- `content`：回复内容
- `admin_id` / `admin_username`：回复管理员
- `created_at`：回复时间

同一留言可以有多条回复；回复不覆盖历史，并会向留言提交者发送 `feedback_reply` 通知。

### 1.8 announcements（公告）

- `content`
- `updated_at`

### 1.9 update_announcements（更新公告）

- `id`
- `content`
- `updated_at`

### 1.10 app_settings（站点设置）

- `key`：主键
- `value`
- `updated_at`

目前至少包含：

- `turnstile_enabled`
- `cny_theme_enabled`

春节皮肤是否实际生效由后端按农历窗口动态计算（腊月十六至正月十五）。

### 1.11 vocabulary_words（敏感词）

- `word`：原词
- `normalized`：归一化后用于去重（唯一）
- `enabled`：启用/禁用
- `created_at` / `updated_at`

### 1.12 stats_daily / daily_visits / fingerprint_login_days（统计）

用于后台概览统计：

- `stats_daily(date, visits, posts, reports)`
- `daily_visits(date, session_id)`：访客去重
- `fingerprint_login_days(date, fingerprint)`：按指纹统计活跃天数/彩蛋

补充说明：

- `fingerprint_login_days` 仍按单个哈希落库
- 连续登录彩蛋查询阶段会结合 `identity_aliases` 聚合同一身份下的多份记录

### 1.13 post_edits / admin_audit_logs（审计）

- `post_edits`：后台编辑帖子内容的前后对比与原因
- `admin_audit_logs`：后台动作审计（action、target、before_json/after_json、reason、ip、session_id）

### 1.14 recruitment_*（队伍招募）

招募业务使用独立表组，不复用普通帖子、评论或通知表：

- `recruitment_posts`：招募正文、发布者 canonical 身份哈希、心法 ID、业务状态与治理状态。
- `recruitment_threads`：发布者与申请者的一对一会话；同一招募与申请者只能建立一个会话。`status` 只表示 `active` / `closed`，后台锁定由独立的 `locked_at`、`locked_by`、`lock_reason` 表示。
- `recruitment_messages`：密聊消息密文、加密参数、客户端幂等 ID 与软删除状态。
- `recruitment_message_moderation_events`：消息删除与恢复的递增事件流；会话客户端以 `seq` 为治理游标同步已加载消息的最新状态。
- `recruitment_contact_exchanges` / `recruitment_exchange_consents`：联系方式密文、双方同意状态与软删除状态。
- `recruitment_reports` / `recruitment_report_evidence`：针对招募、会话、消息或联系方式的举报，以及举报时明确选入的消息证据。联系方式举报额外保存 `contact_payload_ciphertext`、`contact_payload_iv`、`contact_payload_auth_tag`、`contact_crypto_version` 和 `contact_was_unlocked`，用于保留提交瞬间的加密快照。
- `recruitment_notifications`：申请、消息和联系方式交换产生的独立通知流。
- `recruitment_admin_audit_logs`：招募证据查看和治理动作的专用审计记录。

心法目录不落数据库，以 `server/recruitment-catalog.js` 为发布和申请时的权威校验来源。当前目录提供 23 个 UI 选项，对应 24 条源记录；藏剑使用统一目录 ID `cangjian`，并在 `sourceIds` 中保留问水诀 `10144` 与山居剑意 `10145`。数据库只写入统一 ID，`10144` / `10145` 不作为独立 UI 选项或可提交的目录 ID。

密聊正文和联系方式只保存密文。联系方式只有在双方已完成解锁后才能被举报；提交举报时复制当时的密文快照，后续联系方式修改或删除不覆盖举报证据。后台不提供全量密聊列表或按会话浏览正文的接口，只能基于具体举报读取该举报已绑定的有限证据；联系方式快照仅在对应联系方式举报中按审计理由解密。

帖子、会话、消息和联系方式的后台治理动作都必须关联具体 `report_id`，并在事务内校验举报的目标类型和目标 ID（消息还可校验其是否为该举报的证据）；不允许仅凭资源 ID 直接治理。

## 2. 删除语义（重要）

### 2.1 帖子

以 `deleted` 软删除为主，并维护 `deleted_at` 与计数字段；帖子相关联的一些表通过外键 `ON DELETE CASCADE` 可能在硬删时被级联清理（但“硬删帖子”是否存在取决于后台动作实现）。

发帖人申请删除不会立即修改 `posts.deleted`；只有管理员在删除申请队列中审核通过后才执行软删除。

### 2.2 评论

同样以 `deleted` 软删除为主。**当前后台“删除评论”是仅删除当前一条（不级联子回复）**：只把该评论 `deleted=1`，并将帖子 `comments_count` 减 1。

> 这意味着如果你希望“删除楼层时连带删除其回复”，需要在业务逻辑层自行实现级联软删（数据库层没有外键级联到子评论）。



## 3. 角色 Wiki 数据模型

角色 Wiki 使用两张表：`wiki_entries` 和 `wiki_entry_revisions`。

### 3.1 wiki_entries

`wiki_entries` 保存当前公开瓜条快照，只用于读取公开内容：

- `id`：整数主键。
- `slug`：公开详情页路径标识，唯一。
- `name`：角色名字。
- `narrative`：记录叙述。
- `tags`：JSON 字符串，保存清洗后的 tags 数组。
- `related_post_ids_json`：JSON 字符串，按添加顺序保存最多 5 个相关帖子 ID；不保存帖子正文快照，也不建立外键。
- `attachments_json`：JSON 字符串，保存分组图片附件，结构为 `[{ "title": string, "imageUrls": string[] }]`，默认值为 `[]`。
- `status`：当前瓜条状态，公开读取只使用 `approved`。
- `current_revision_id`：当前公开版本对应的 revision。
- `version_number`：当前公开版本号。
- `created_at` / `updated_at`：创建与更新时间。
- `deleted` / `deleted_at`：软删除标记与删除时间。

### 3.2 wiki_entry_revisions

`wiki_entry_revisions` 保存用户投稿、用户编辑和管理员直接编辑形成的版本记录：

- `id`：整数主键。
- `entry_id`：关联公开瓜条。新瓜条待审核时可为空。
- `action_type`：`create` 或 `edit`。
- `base_revision_id`：编辑基于的公开 revision。
- `base_version_number`：编辑基于的公开版本号。
- `data_json`：完整版本内容，包含 `name`、`narrative`、`tags`、`relatedPostIds`、`attachments`。
- `edit_summary`：修改说明。
- `status`：`pending`、`approved`、`rejected`。
- `submitter_fingerprint`：提交者指纹。
- `submitter_ip`：提交者 IP。
- `created_at`：提交时间。
- `review_reason`：审核原因或拒绝原因。
- `reviewed_at`：审核时间。
- `reviewed_by`：审核管理员。

### 3.3 发布语义

- 新瓜条投稿先写入 `wiki_entry_revisions`，状态为 `pending`，不会写入公开列表。
- 新瓜条审核通过后创建 `wiki_entries` 快照，版本号为 `1`，并把对应 revision 标记为 `approved`。
- 编辑投稿先写入 `wiki_entry_revisions`，状态为 `pending`，不会覆盖公开内容。
- 编辑审核通过后覆盖 `wiki_entries` 当前快照，版本号 `+1`，并把对应 revision 标记为 `approved`。
- 拒绝只更新 revision 状态，不影响 `wiki_entries`。
- 公开详情页的编辑历史只读取 `approved` revision。
- 删除瓜条使用 `deleted` 软删除，删除后公开列表和详情都不可见。

### 3.4 字段边界

角色 Wiki 当前允许保存以下业务字段：

- `name`：名字。
- `narrative`：记录叙述。
- `tags`：标签数组。
- `relatedPostIds`：相关帖子 ID 数组，最多 5 个并去重，单个 ID 最长 128 个字符。
- `attachments`：分组图片附件，最多 5 组、每组 1 至 3 张、总计最多 10 张；组标题最长 60 个字符。

附件只保存经过白名单校验的远端图片 URL，不保存 `File`、Blob URL、Base64 或图片二进制。白名单默认包含 `https://img.zsix.de`、`https://ibed.933211.xyz`，并自动加入当前 `IMGBED_BASE_URL` 的来源；历史图床或独立 CDN 等额外来源通过 `WIKI_ATTACHMENT_ALLOWED_ORIGINS` 显式配置。所有新写入的外部附件必须使用 HTTPS，仅本地回环地址允许 HTTP 以便开发调试。

相关帖子不使用数据库外键。帖子删除或隐藏不会破坏瓜条数据，读取详情时再根据帖子当前状态生成 `available`；历史版本只保留当时的帖子 ID，不保留正文摘要快照。

数据库迁移对旧瓜条使用 `related_post_ids_json = '[]'`、`attachments_json = '[]'`，不批量重写历史 `data_json`。解析旧 revision 时缺失字段按空数组处理；审核旧编辑时由服务端按兼容规则继承当前公开值，避免静默清空后来新增的相关资料。

不要新增或保留以下角色档案字段：

- `affiliations_json`
- `attributes_json`
- `activities_json`
- `role_title`
- `summary`
- `biography`
- `early_experience`
- `philosophy`
- `quote`
- `social_function`
- `visual_description`
