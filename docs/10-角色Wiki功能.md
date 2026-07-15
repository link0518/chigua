# 10-角色 Wiki 功能

本页记录独立角色 Wiki 的页面、数据、接口与审核规则。该功能的前台入口是 `/wiki`，作为独立 Nordic 风格页面存在，不继承主站吃瓜页面的手绘视觉体系。

## 1. 功能边界

- 第一版只做角色瓜条，不做奇物、组织或时间线瓜条。
- 前台页面包括角色画廊、角色详情、提交瓜条弹窗、编辑瓜条弹窗。
- 用户可以提交新瓜条，也可以编辑已有瓜条。
- 每条瓜条可以按顺序关联最多 5 个站内帖子；点击可用帖子会在新标签页打开对应 `/post/:id`。
- 每条瓜条可以添加分组图片附件，每组由一个标题和 1 至 3 张图片组成。
- 投稿和编辑都必须进入后台 Wiki 审核模块，审核通过后才会公开。
- 详情页展示当前公开内容、附件标题列表、相关帖子和编辑历史；点击附件标题后只浏览该组图片。
- 编辑历史只展示已审核通过的版本，待审核和已拒绝版本只在后台可见。

## 2. 页面与组件

前台路由：

- `/wiki`：角色画廊首页，支持搜索、tag 筛选和分页。
- `/wiki/:slug`：角色详情页，展示公开瓜条内容与通过历史。

移动端浏览规则：

- `/wiki` 在移动端使用信息流模式，向下滑动时自动加载下一页瓜条。
- 移动端不展示“上一页 / 下一页”分页按钮。
- 移动端顶部保留搜索框，搜索逻辑与桌面侧栏一致。
- 桌面端继续使用分页浏览，避免一次性加载过多内容。

主要组件：

- `WikiView`：Wiki 页面入口，负责画廊、详情与弹窗状态。
- `WikiShell`：独立 Nordic 页面壳，包含浮动导航和目录区域。
- `WikiGallery`：角色卡片网格、搜索、tag 筛选、分页。
- `WikiEntryDetail`：展示名字、tags、记录叙述、相关帖子、附件和编辑入口。
- `WikiRevisionHistory`：展示已通过版本号、通过时间、修改说明及对应版本的相关资料。
- `WikiEntryFormModal`：提交和编辑共用弹窗，协调相关帖子输入、附件草稿和图片上传。
- `WikiRelatedPostField` / `WikiAttachmentEditor`：公开端表单的相关帖子与附件草稿编辑组件。
- `WikiRelatedPostList` / `WikiAttachmentList`：公开端只读展示组件，负责失效状态、附件标题列表和分组图片查看。
- `AdminWikiPanel`：后台 Wiki 审核与瓜条管理模块，可查看并编辑多个相关帖子与分组附件。

视觉要求：

- 使用 `jx3wiki/stitch_nordic_jx3_wiki` 的 Nordic 浅色纸张层级、浮动导航、柔和阴影、Manrope / Work Sans 排版。
- 不使用主站 `SketchUI`、`font-hand`、`paper`、`ink`、手绘阴影等视觉元素。
- 不展示所属机构、能力数值、近期动态，也不保留相关卡片、图标、进度条或时间线。

## 3. 瓜条字段

公开瓜条和审核记录允许保存以下业务字段：

- `name`：名字，必填。
- `narrative`：记录叙述，必填。
- `tags`：标签数组，清洗、去重并限制长度。
- `relatedPostIds`：相关帖子 ID 数组，最多 5 个，按添加顺序保存并去重，单个 ID 最长 128 个字符。
- `attachments`：图片附件数组，每项为 `{ title, imageUrls }`。

用户提交与编辑表单包含：

- 名字
- 记录叙述
- tags
- 相关帖子（选填，可粘贴完整链接、`/post/:id` 路径或原始 ID）
- 图片附件（选填）

附件限制：

- 每条瓜条最多 5 个附件标题。
- 每组至少 1 张、最多 3 张，总计最多 10 张。
- 标题必填且最长 60 个字符。
- 单图最大 5MB，只允许 JPEG、PNG、GIF、WebP。
- 图片按选择顺序保存；第一版不提供拖拽排序。
- 业务数据只保存远端 URL，不保存 `File`、Blob URL、Base64 或图片二进制。

仍禁止重新引入以下角色档案字段：

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

## 4. 数据表

`wiki_entries` 保存当前公开瓜条快照：

- `id`
- `slug`
- `name`
- `narrative`
- `tags`
- `related_post_ids_json`：相关帖子 ID 数组，默认 `[]`
- `attachments_json`：分组附件数组，默认 `[]`
- `status`
- `current_revision_id`
- `version_number`
- `created_at`
- `updated_at`
- `deleted`
- `deleted_at`

`wiki_entry_revisions` 保存投稿与编辑审核记录：

- `id`
- `entry_id`
- `action_type`：`create` 或 `edit`
- `base_revision_id`
- `base_version_number`
- `data_json`：包含 `name`、`narrative`、`tags`、`relatedPostIds`、`attachments`
- `edit_summary`
- `status`：`pending`、`approved`、`rejected`
- `submitter_fingerprint`
- `submitter_ip`
- `created_at`
- `review_reason`
- `reviewed_at`
- `reviewed_by`

`related_post_ids_json` 不建立外键：帖子隐藏、软删除或恢复不会修改瓜条记录，读取时再计算当前 `available` 状态。`attachments_json` 只存储已经过来源白名单校验的远端 URL。

迁移对旧公开瓜条补充两个默认空数组，不批量重写历史 revision。旧版本缺失字段时按空数组解析；审核旧编辑时服务端使用兼容继承规则，避免把当前公开版本后来新增的相关资料清空。

## 5. 公开接口

- `GET /api/wiki/entries?q=&tag=&page=&limit=&sort=`：查询公开瓜条列表。
- `GET /api/wiki/entries/:slug`：查询公开瓜条详情与已通过历史。
- `POST /api/wiki/submissions`：提交新瓜条，进入待审核。
- `POST /api/wiki/entries/:slug/edits`：提交已有瓜条编辑，进入待审核。

投稿与编辑请求体统一为：

```json
{
  "name": "叶英",
  "narrative": "记录叙述内容",
  "tags": ["藏剑山庄", "庄主"],
  "relatedPostIds": ["25db9767-ddf2-420f-862a-e492c67fe224"],
  "attachments": [
    {
      "title": "聊天记录截图",
      "imageUrls": [
        "https://img.zsix.de/wiki/1.webp",
        "https://img.zsix.de/wiki/2.webp"
      ]
    }
  ],
  "editSummary": "补充或修改说明"
}
```

公开接口只返回 `status=approved` 且未删除的瓜条。待审核和已拒绝内容不会出现在公开列表、详情或历史中。

编辑请求未携带 `relatedPostIds` 或 `attachments` 时继承当前公开值；显式提交 `[]` 才表示清空对应内容。新建投稿缺失字段时按空数组处理。

`GET /api/wiki/entries` 的 `sort` 支持：

- `updated`：按更新时间倒序，作为默认排序。
- `number`：按瓜条编号正序。
- 非法值按 `updated` 处理。

公开列表保持轻量，不需要返回完整附件 URL。详情接口返回：

- `relatedPostIds`：保存的帖子 ID 顺序。
- `relatedPosts`：`{ id, available, excerpt? }[]`；隐藏、删除或不存在的帖子只返回 `available: false`，不泄露摘要。
- `attachments`：完整的附件标题与图片 URL 数组。
- `history`：各已通过 revision 当时保存的相关帖子 ID 和附件；帖子可用状态仍按当前帖子状态计算。

Wiki 图片通过 `POST /api/uploads/image?usage=wiki` 上传。客户端保存前先逐条调用帖子详情接口校验相关帖子，再上传尚未持久化的图片，全部成功后才提交瓜条；失败时保留已成功 URL，重试只上传失败或未上传项。服务端仍会在接收提交和审核通过时重新校验，客户端校验不能替代安全边界。

上传过程中禁止重复提交；已经有图片上传成功但瓜条尚未保存时，关闭弹窗必须提示用户确认，说明已上传文件可能成为无法自动清理的孤儿图片。

公开详情接口的 `history` 必须脱敏，只允许返回页面展示所需字段：

- `id`
- `actionType`
- `data`
- `editSummary`
- `status`
- `createdAt`
- `reviewedAt`
- `versionNumber`

公开历史不得返回 `submitter_fingerprint`、`submitter_ip`、`reviewed_by` 或其他后台审计元数据。

## 6. 后台接口

- `GET /api/admin/wiki/revisions?status=&actionType=&q=&page=&limit=`：查询审核记录。
- `GET /api/admin/wiki/entries?status=&q=&page=&limit=`：查询当前公开瓜条。
- `POST /api/admin/wiki/entries`：管理员直接创建公开瓜条。
- `POST /api/admin/wiki/revisions/:id/action`：审核通过或拒绝。
- `POST /api/admin/wiki/entries/:id/edit`：管理员直接编辑公开瓜条。
- `POST /api/admin/wiki/entries/:id/action`：删除或恢复公开瓜条。

管理端 `revisions` 在 `data.relatedPostIds`、`data.attachments` 之外，顶层返回 `relatedPosts` 当前状态；管理端 `entries` 返回当前公开快照的 `relatedPostIds`、`attachments`、`relatedPosts`。这样审核员可以在处理前确认失效帖子并查看全部图片。

后台模块包含：

- 待审核：新瓜条投稿与瓜条编辑请求。
- 已通过：已发布版本记录。
- 已拒绝：被拒绝的投稿和编辑。
- 审核卡片：显示相关帖子 ID、当前可用状态与摘要，并展示所有附件标题、数量和缩略图；点击缩略图按附件组打开图片查看器。
- 瓜条管理：当前公开瓜条的删除、恢复、管理员直接编辑；编辑器支持增删多个相关帖子、分组附件、批量选图和上传失败重试。

## 7. 审核规则

- 新瓜条通过后创建公开瓜条，版本号为 `1`。
- 编辑通过后覆盖当前公开瓜条，版本号 `+1`。
- 编辑审核通过前必须校验 `base_revision_id` 与 `base_version_number` 是否仍匹配当前公开版本。
- 若瓜条已经有更新版本，旧待审编辑不得直接通过覆盖，应要求重新提交或由管理员基于最新内容手动合并。
- 投稿、编辑、管理员创建、管理员编辑以及审核通过时都逐条校验相关帖子。审核期间任一帖子变为隐藏、删除或不存在时，审核整体失败并指出失效帖子，不静默移除。
- 审核通过时，正文、标签、相关帖子、附件、公开快照和 revision 状态必须在同一数据库事务内更新；任一步失败都回滚。
- 拒绝不会影响当前公开内容，也不会进入公开编辑历史。
- 删除瓜条后，公开列表和公开详情都不可见。
- 恢复瓜条后，继续展示当前公开快照和已通过历史。
- 管理员直接编辑会生成包含完整相关帖子与附件的已通过版本，并写入审计日志。

## 8. 治理与校验

新瓜条和编辑瓜条都执行：

- 名字、记录叙述必填校验。
- tags 清洗、去重、长度限制。
- 相关帖子 ID 去重、数量限制、存在性和公开状态校验。
- 附件组数、标题、单组图片数、总图片数、URL 长度、URL 去重和来源白名单校验；非法附件整体拒绝，不静默丢弃部分图片。
- 指纹与 IP 记录。
- Turnstile 校验。
- `wiki` 限流校验，默认 `3 次 / 小时`。

图片上传规则：

- `usage=wiki` 与普通帖子、评论共用 `upload` 图片上传限流，默认 `12 次 / 分钟`；客户端不能通过切换 `usage` 绕过统一额度。
- Wiki 上传使用共享图片端点，同时受发帖和评论封禁权限控制，避免上传 URL 被跨业务复用来规避封禁。
- 服务端同时校验 `Content-Type` 和文件头，只接受 JPEG、PNG、GIF、WebP，单图最大 5MB。
- 附件来源白名单默认包含 `https://img.zsix.de`、`https://ibed.933211.xyz`，并自动加入当前 `IMGBED_BASE_URL` 的来源；历史图床或独立 CDN 等额外来源通过 `WIKI_ATTACHMENT_ALLOWED_ORIGINS` 配置。所有新写入的外部附件只允许 HTTPS，本地回环 HTTP 仅用于开发；上传代理会在发送 Bearer Token 前完成地址校验并拒绝上游重定向。
- 明确拒绝 `data:`、`blob:`、`javascript:` 等不可持久化或危险协议。
- 当前图床没有删除接口；上传后取消或审核拒绝可能留下孤儿图片，首版不承诺自动清理。

后台审核、拒绝、删除、恢复、管理员创建和管理员编辑都应写入现有审计日志。

## 9. 验收要点

- `/wiki` 与 `/wiki/:slug` 不出现主站手绘视觉元素。
- 提交和编辑弹窗包含名字、记录叙述、tags、相关帖子和分组图片附件，且数量与格式限制正确。
- 相关帖子支持完整链接、站内路径和原始 ID，重复 ID 不会被加入；最多保存 5 个并保持添加顺序。
- 一组单图、一组多图和多组附件都能正确展示，点击附件标题只浏览该组图片且顺序不变。
- 部分图片上传失败后不提交瓜条，重试只上传失败或未上传项。
- 详情页展示名字、tags、记录叙述、附件、相关帖子和编辑历史；没有相关资料时不渲染空区域。
- 详情页完全没有所属机构、能力数值、近期动态相关内容。
- 关联帖子隐藏或删除后显示不可用、不泄露摘要且不可跳转；恢复公开后可重新打开，其他关联不受影响。
- 投稿或编辑提交后不会立即公开，后台审核通过后才生效。
- 通过编辑后详情页内容更新，编辑历史新增已通过版本。
- 后台审核可以看到全部相关帖子状态与附件图片，管理员直接编辑可以增删这些字段。
- 历史版本保留当时的相关帖子 ID、附件标题和图片 URL，不被当前版本覆盖。
- 公开编辑历史不包含提交者 IP、指纹或后台审核账号。
- 多个待审编辑乱序审核时，旧编辑不能覆盖已经更新的公开版本。
- 拒绝编辑后公开内容不变，公开历史不新增。
- 删除瓜条后公开列表和详情都不可见。
