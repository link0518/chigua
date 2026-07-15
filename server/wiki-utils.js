const MAX_WIKI_TAGS = 6;
const MAX_WIKI_TAG_LENGTH = 16;
const MAX_WIKI_NAME_LENGTH = 80;
const MAX_WIKI_NARRATIVE_LENGTH = 8000;
const MAX_WIKI_EDIT_SUMMARY_LENGTH = 500;
const MAX_WIKI_RELATED_POSTS = 5;
const MAX_WIKI_RELATED_POST_ID_LENGTH = 128;
const MAX_WIKI_ATTACHMENTS = 5;
const MAX_WIKI_ATTACHMENT_TITLE_LENGTH = 60;
const MAX_WIKI_ATTACHMENT_IMAGES = 3;
const MAX_WIKI_ATTACHMENT_TOTAL_IMAGES = 10;
const MAX_WIKI_ATTACHMENT_URL_LENGTH = 2048;
const DEFAULT_WIKI_ATTACHMENT_ORIGINS = [
  'https://img.zsix.de',
  'https://ibed.933211.xyz',
];

export const WIKI_REVISION_STATUSES = ['pending', 'approved', 'rejected'];
export const WIKI_ACTION_TYPES = ['create', 'edit'];

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);

const parseJsonValue = (value, fallback) => {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  if (typeof value !== 'string') {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const normalizeAttachmentOrigins = (input) => {
  const source = Array.isArray(input)
    ? input
    : String(input || '').split(/[\s,，;；]+/g);
  const result = [];
  const seen = new Set();
  source.forEach((item) => {
    const raw = String(item || '').trim();
    if (!raw) {
      return;
    }
    try {
      const origin = new URL(raw).origin.toLowerCase();
      if (!seen.has(origin)) {
        seen.add(origin);
        result.push(origin);
      }
    } catch {
      // 非法配置不应放宽附件来源限制。
    }
  });
  return result;
};

const isLoopbackHostname = (hostname) => {
  const normalized = String(hostname || '').trim().toLowerCase().replace(/\.$/, '');
  if (normalized === 'localhost' || normalized.endsWith('.localhost')) {
    return true;
  }
  if (normalized === '::1' || normalized === '[::1]') {
    return true;
  }
  const ipv4Parts = normalized.split('.');
  return ipv4Parts.length === 4
    && ipv4Parts[0] === '127'
    && ipv4Parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
};

export const buildWikiAttachmentValidationOptions = (runtimeConfig = {}) => ({
  allowedAttachmentOrigins: normalizeAttachmentOrigins([
    ...DEFAULT_WIKI_ATTACHMENT_ORIGINS,
    runtimeConfig?.imgbedBaseUrl,
    ...normalizeAttachmentOrigins(runtimeConfig?.wikiAttachmentAllowedOrigins),
  ]),
});

export const normalizeWikiTag = (value) => String(value || '')
  .trim()
  .replace(/^#+/, '')
  .replace(/\s+/g, ' ');

export const parseWikiTags = (value) => {
  if (!value) {
    return [];
  }
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const sanitizeWikiTags = (input) => {
  const source = Array.isArray(input)
    ? input
    : String(input || '')
      .split(/[\r\n,，、;；|]+/g);
  const result = [];
  const seen = new Set();
  for (const item of source) {
    const normalized = normalizeWikiTag(item);
    if (!normalized || normalized.length > MAX_WIKI_TAG_LENGTH) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(normalized);
    if (result.length >= MAX_WIKI_TAGS) {
      break;
    }
  }
  return result;
};

export const sanitizeWikiRelatedPostIds = (input) => {
  if (!Array.isArray(input)) {
    return { ok: false, error: '相关帖子格式错误', data: [] };
  }
  const result = [];
  const seen = new Set();
  for (const item of input) {
    if (typeof item !== 'string') {
      return { ok: false, error: '相关帖子 ID 格式错误', data: [] };
    }
    const id = item.trim();
    if (!id || id.length > MAX_WIKI_RELATED_POST_ID_LENGTH) {
      return { ok: false, error: '相关帖子 ID 格式错误', data: [] };
    }
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    result.push(id);
    if (result.length > MAX_WIKI_RELATED_POSTS) {
      return { ok: false, error: `相关帖子最多 ${MAX_WIKI_RELATED_POSTS} 个`, data: [] };
    }
  }
  return { ok: true, error: '', data: result };
};

export const parseWikiRelatedPostIds = (value) => {
  const parsed = parseJsonValue(value, []);
  const result = sanitizeWikiRelatedPostIds(parsed);
  return result.ok ? result.data : [];
};

export const sanitizeWikiAttachments = (input, options = {}) => {
  if (!Array.isArray(input)) {
    return { ok: false, error: '附件格式错误', data: [] };
  }
  if (input.length > MAX_WIKI_ATTACHMENTS) {
    return { ok: false, error: `附件最多 ${MAX_WIKI_ATTACHMENTS} 组`, data: [] };
  }

  const allowedOrigins = new Set(
    normalizeAttachmentOrigins(options.allowedAttachmentOrigins).map((origin) => origin.toLowerCase())
  );
  const allowAnyAttachmentOrigin = options.allowAnyAttachmentOrigin === true;
  const allowInsecureHttpAttachments = options.allowInsecureHttpAttachments === true;
  const seenUrls = new Set();
  const attachments = [];
  let totalImages = 0;

  for (const item of input) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return { ok: false, error: '附件格式错误', data: [] };
    }
    const title = String(item.title || '').trim();
    if (!title || title.length > MAX_WIKI_ATTACHMENT_TITLE_LENGTH) {
      return {
        ok: false,
        error: `附件标题需为 1-${MAX_WIKI_ATTACHMENT_TITLE_LENGTH} 个字符`,
        data: [],
      };
    }
    if (!Array.isArray(item.imageUrls)) {
      return { ok: false, error: `附件“${title}”的图片格式错误`, data: [] };
    }
    if (item.imageUrls.length < 1 || item.imageUrls.length > MAX_WIKI_ATTACHMENT_IMAGES) {
      return {
        ok: false,
        error: `附件“${title}”需包含 1-${MAX_WIKI_ATTACHMENT_IMAGES} 张图片`,
        data: [],
      };
    }

    const imageUrls = [];
    for (const value of item.imageUrls) {
      if (typeof value !== 'string') {
        return { ok: false, error: `附件“${title}”包含无效图片地址`, data: [] };
      }
      const imageUrl = value.trim();
      if (!imageUrl || imageUrl.length > MAX_WIKI_ATTACHMENT_URL_LENGTH) {
        return { ok: false, error: `附件“${title}”包含无效图片地址`, data: [] };
      }
      let parsedUrl;
      try {
        parsedUrl = new URL(imageUrl);
      } catch {
        return { ok: false, error: `附件“${title}”包含无效图片地址`, data: [] };
      }
      if (!['http:', 'https:'].includes(parsedUrl.protocol) || parsedUrl.username || parsedUrl.password) {
        return { ok: false, error: `附件“${title}”包含无效图片地址`, data: [] };
      }
      if (
        parsedUrl.protocol === 'http:'
        && !allowInsecureHttpAttachments
        && !isLoopbackHostname(parsedUrl.hostname)
      ) {
        return { ok: false, error: '附件图片必须使用 HTTPS 地址（本地回环地址除外）', data: [] };
      }
      if (!allowAnyAttachmentOrigin && !allowedOrigins.has(parsedUrl.origin.toLowerCase())) {
        return { ok: false, error: '附件图片地址不在允许的图床范围内', data: [] };
      }
      if (seenUrls.has(imageUrl)) {
        return { ok: false, error: '同一瓜条不能重复使用相同的附件图片', data: [] };
      }
      seenUrls.add(imageUrl);
      imageUrls.push(imageUrl);
      totalImages += 1;
      if (totalImages > MAX_WIKI_ATTACHMENT_TOTAL_IMAGES) {
        return {
          ok: false,
          error: `每条瓜条的附件图片总数不能超过 ${MAX_WIKI_ATTACHMENT_TOTAL_IMAGES} 张`,
          data: [],
        };
      }
    }
    attachments.push({ title, imageUrls });
  }

  return { ok: true, error: '', data: attachments };
};

export const parseWikiAttachments = (value) => {
  const parsed = parseJsonValue(value, []);
  const result = sanitizeWikiAttachments(parsed, {
    allowAnyAttachmentOrigin: true,
    allowInsecureHttpAttachments: true,
  });
  return result.ok ? result.data : [];
};

export const sanitizeWikiPayload = (input = {}, options = {}) => {
  const name = String(input?.name || '').trim().replace(/\s+/g, ' ');
  const narrative = String(input?.narrative || '').trim();
  const tags = sanitizeWikiTags(input?.tags);
  const editSummary = String(input?.editSummary || '').trim().slice(0, MAX_WIKI_EDIT_SUMMARY_LENGTH);
  const fallbackData = options.fallbackData && typeof options.fallbackData === 'object'
    ? options.fallbackData
    : {};
  const relatedPostIdsInput = hasOwn(input, 'relatedPostIds')
    ? input.relatedPostIds
    : fallbackData.relatedPostIds ?? [];
  const attachmentsInput = hasOwn(input, 'attachments')
    ? input.attachments
    : fallbackData.attachments ?? [];
  const relatedPostIdsResult = sanitizeWikiRelatedPostIds(relatedPostIdsInput);
  const attachmentsResult = sanitizeWikiAttachments(attachmentsInput, options);
  const errors = [];

  if (!name) {
    errors.push('名字不能为空');
  }
  if (name.length > MAX_WIKI_NAME_LENGTH) {
    errors.push(`名字不能超过 ${MAX_WIKI_NAME_LENGTH} 个字符`);
  }
  if (!narrative) {
    errors.push('记录叙述不能为空');
  }
  if (narrative.length > MAX_WIKI_NARRATIVE_LENGTH) {
    errors.push(`记录叙述不能超过 ${MAX_WIKI_NARRATIVE_LENGTH} 个字符`);
  }
  if (!relatedPostIdsResult.ok) {
    errors.push(relatedPostIdsResult.error);
  }
  if (!attachmentsResult.ok) {
    errors.push(attachmentsResult.error);
  }

  return {
    ok: errors.length === 0,
    error: errors[0] || '',
    data: {
      name,
      narrative,
      tags,
      relatedPostIds: relatedPostIdsResult.data,
      attachments: attachmentsResult.data,
      editSummary,
    },
  };
};

export const parseWikiRevisionData = (value) => {
  try {
    const parsed = JSON.parse(String(value || '{}'));
    const sanitized = sanitizeWikiPayload(parsed, {
      allowAnyAttachmentOrigin: true,
      allowInsecureHttpAttachments: true,
    });
    return sanitized.data;
  } catch {
    return {
      name: '',
      narrative: '',
      tags: [],
      relatedPostIds: [],
      attachments: [],
      editSummary: '',
    };
  }
};

export const serializeWikiRevisionData = (data = {}) => JSON.stringify({
  name: data.name,
  narrative: data.narrative,
  tags: Array.isArray(data.tags) ? data.tags : [],
  relatedPostIds: Array.isArray(data.relatedPostIds) ? data.relatedPostIds : [],
  attachments: Array.isArray(data.attachments) ? data.attachments : [],
});

export const validatePublicWikiRelatedPosts = (db, relatedPostIds = []) => {
  const statement = db.prepare(
    'SELECT id FROM posts WHERE id = ? AND deleted = 0 AND hidden = 0'
  );
  for (const id of relatedPostIds) {
    if (!statement.get(id)) {
      return { ok: false, error: `关联帖子不存在或已不可用：${id}` };
    }
  }
  return { ok: true, error: '' };
};

export const resolveWikiRelatedPosts = (db, relatedPostIds = []) => {
  if (!relatedPostIds.length) {
    return [];
  }
  const placeholders = relatedPostIds.map(() => '?').join(', ');
  const rows = db.prepare(
    `SELECT id, content, deleted, hidden FROM posts WHERE id IN (${placeholders})`
  ).all(...relatedPostIds);
  const rowMap = new Map(rows.map((row) => [String(row.id), row]));
  return relatedPostIds.map((id) => {
    const row = rowMap.get(id);
    if (!row || row.deleted === 1 || row.hidden === 1) {
      return { id, available: false };
    }
    const content = String(row.content || '').trim().replace(/\s+/g, ' ');
    return {
      id,
      available: true,
      excerpt: content.length > 120 ? `${content.slice(0, 120)}…` : content,
    };
  });
};

export const createWikiSlugBase = (name) => {
  const normalized = String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return normalized || `entry-${Date.now().toString(36)}`;
};

export const resolveUniqueWikiSlug = (db, name, excludeEntryId = '') => {
  const base = createWikiSlugBase(name);
  let candidate = base;
  let index = 2;
  const exists = excludeEntryId
    ? db.prepare('SELECT id FROM wiki_entries WHERE slug = ? AND id != ?')
    : db.prepare('SELECT id FROM wiki_entries WHERE slug = ?');
  while (excludeEntryId ? exists.get(candidate, excludeEntryId) : exists.get(candidate)) {
    candidate = `${base}-${index}`;
    index += 1;
  }
  return candidate;
};

export const getNextWikiDisplayOrder = (db) => {
  const row = db
    .prepare('SELECT COALESCE(MAX(display_order), 0) AS max_display_order FROM wiki_entries')
    .get();
  return Number(row?.max_display_order || 0) + 1;
};

export const isWikiDisplayOrderConflict = (error) => /wiki_entries\.display_order|idx_wiki_entries_display_order_unique/i.test(String(error?.message || ''));

export const mapWikiEntryRow = (row, options = {}) => {
  const relatedPostIds = parseWikiRelatedPostIds(row.related_post_ids_json);
  const entry = {
    id: row.id,
    slug: row.slug,
    name: row.name,
    narrative: row.narrative,
    tags: parseWikiTags(row.tags),
    relatedPostIds,
    status: row.status,
    currentRevisionId: row.current_revision_id || null,
    versionNumber: Number(row.version_number || 1),
    displayOrder: Number(row.display_order || row.displayOrder || 0) || null,
    createdAt: Number(row.created_at || 0),
    updatedAt: Number(row.updated_at || 0),
    deleted: row.deleted === 1,
    deletedAt: row.deleted_at || null,
  };
  if (options.includeAttachments !== false) {
    entry.attachments = parseWikiAttachments(row.attachments_json);
  }
  return entry;
};

export const mapWikiRevisionRow = (row, versionNumber = null) => ({
  id: row.id,
  entryId: row.entry_id || null,
  entryName: row.entry_name || null,
  entrySlug: row.entry_slug || null,
  actionType: row.action_type,
  baseRevisionId: row.base_revision_id || null,
  baseVersionNumber: Number(row.base_version_number || 0),
  data: parseWikiRevisionData(row.data_json),
  editSummary: row.edit_summary || '',
  status: row.status,
  submitterFingerprint: row.submitter_fingerprint || null,
  submitterIp: row.submitter_ip || null,
  createdAt: Number(row.created_at || 0),
  reviewReason: row.review_reason || '',
  reviewedAt: row.reviewed_at || null,
  reviewedBy: row.reviewed_by || null,
  versionNumber: versionNumber ?? null,
});
