# 10-角色 Wiki 功能

本页记录独立角色 Wiki 的页面、数据、接口与审核规则。该功能的前台入口是 `/wiki`，作为独立 Nordic 风格页面存在，不继承主站吃瓜页面的手绘视觉体系。

## 1. 功能边界

- 第一版只做角色瓜条，不做奇物、组织或时间线瓜条。
- 前台页面包括角色画廊、角色详情、提交瓜条弹窗、编辑瓜条弹窗。
- 用户可以提交新瓜条，也可以编辑已有瓜条。
- 投稿和编辑都必须进入后台 Wiki 审核模块，审核通过后才会公开。
- 详情页展示当前公开内容和编辑历史。
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
- `WikiEntryDetail`：展示名字、tags、记录叙述、编辑入口。
- `WikiRevisionHistory`：展示已通过版本号、通过时间、修改说明。
- `WikiEntryFormModal`：提交和编辑共用弹窗。
- `AdminWikiPanel`：后台 Wiki 审核与瓜条管理模块。

视觉要求：

- 使用 `jx3wiki/stitch_nordic_jx3_wiki` 的 Nordic 浅色纸张层级、浮动导航、柔和阴影、Manrope / Work Sans 排版。
- 不使用主站 `SketchUI`、`font-hand`、`paper`、`ink`、手绘阴影等视觉元素。
- 不展示所属机构、能力数值、近期动态，也不保留相关卡片、图标、进度条或时间线。

## 3. 瓜条字段

公开瓜条和审核记录只允许保存以下业务字段：

- `name`：名字，必填。
- `narrative`：记录叙述，必填。
- `tags`：标签数组，清洗、去重并限制长度。

用户提交与编辑表单也只保留：

- 名字
- 记录叙述
- tags

禁止重新引入以下字段：

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
- `data_json`：只包含 `name`、`narrative`、`tags`
- `edit_summary`
- `status`：`pending`、`approved`、`rejected`
- `submitter_fingerprint`
- `submitter_ip`
- `created_at`
- `review_reason`
- `reviewed_at`
- `reviewed_by`

## 5. 公开接口

- `GET /api/wiki/entries?q=&tag=&page=&limit=`：查询公开瓜条列表。
- `GET /api/wiki/entries/:slug`：查询公开瓜条详情与已通过历史。
- `POST /api/wiki/submissions`：提交新瓜条，进入待审核。
- `POST /api/wiki/entries/:slug/edits`：提交已有瓜条编辑，进入待审核。

投稿与编辑请求体统一为：

```json
{
  "name": "叶英",
  "narrative": "记录叙述内容",
  "tags": ["藏剑山庄", "庄主"],
  "editSummary": "补充或修改说明"
}
```

公开接口只返回 `status=approved` 且未删除的瓜条。待审核和已拒绝内容不会出现在公开列表、详情或历史中。

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

后台模块包含：

- 待审核：新瓜条投稿与瓜条编辑请求。
- 已通过：已发布版本记录。
- 已拒绝：被拒绝的投稿和编辑。
- 瓜条管理：当前公开瓜条的删除、恢复、管理员直接编辑。

## 7. 审核规则

- 新瓜条通过后创建公开瓜条，版本号为 `1`。
- 编辑通过后覆盖当前公开瓜条，版本号 `+1`。
- 编辑审核通过前必须校验 `base_revision_id` 与 `base_version_number` 是否仍匹配当前公开版本。
- 若瓜条已经有更新版本，旧待审编辑不得直接通过覆盖，应要求重新提交或由管理员基于最新内容手动合并。
- 拒绝不会影响当前公开内容，也不会进入公开编辑历史。
- 删除瓜条后，公开列表和公开详情都不可见。
- 恢复瓜条后，继续展示当前公开快照和已通过历史。
- 管理员直接编辑会生成已通过版本，并写入审计日志。

## 8. 治理与校验

新瓜条和编辑瓜条都执行：

- 名字、记录叙述必填校验。
- tags 清洗、去重、长度限制。
- 指纹与 IP 记录。
- Turnstile 校验。
- `wiki` 限流校验，默认 `3 次 / 小时`。

后台审核、拒绝、删除、恢复、管理员创建和管理员编辑都应写入现有审计日志。

## 9. 验收要点

- `/wiki` 与 `/wiki/:slug` 不出现主站手绘视觉元素。
- 提交瓜条弹窗只包含名字、记录叙述、tags。
- 编辑瓜条弹窗只包含名字、记录叙述、tags。
- 详情页只展示名字、tags、记录叙述、编辑历史。
- 详情页完全没有所属机构、能力数值、近期动态相关内容。
- 投稿或编辑提交后不会立即公开，后台审核通过后才生效。
- 通过编辑后详情页内容更新，编辑历史新增已通过版本。
- 公开编辑历史不包含提交者 IP、指纹或后台审核账号。
- 多个待审编辑乱序审核时，旧编辑不能覆盖已经更新的公开版本。
- 拒绝编辑后公开内容不变，公开历史不新增。
- 删除瓜条后公开列表和详情都不可见。
