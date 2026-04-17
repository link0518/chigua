const MAX_WIKI_TAGS = 6;
const MAX_WIKI_TAG_LENGTH = 16;
const MAX_WIKI_NAME_LENGTH = 80;
const MAX_WIKI_NARRATIVE_LENGTH = 8000;
const MAX_WIKI_EDIT_SUMMARY_LENGTH = 500;

export const WIKI_REVISION_STATUSES = ['pending', 'approved', 'rejected'];
export const WIKI_ACTION_TYPES = ['create', 'edit'];

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

export const sanitizeWikiPayload = (input = {}) => {
  const name = String(input?.name || '').trim().replace(/\s+/g, ' ');
  const narrative = String(input?.narrative || '').trim();
  const tags = sanitizeWikiTags(input?.tags);
  const editSummary = String(input?.editSummary || '').trim().slice(0, MAX_WIKI_EDIT_SUMMARY_LENGTH);
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

  return {
    ok: errors.length === 0,
    error: errors[0] || '',
    data: { name, narrative, tags, editSummary },
  };
};

export const parseWikiRevisionData = (value) => {
  try {
    const parsed = JSON.parse(String(value || '{}'));
    const sanitized = sanitizeWikiPayload(parsed);
    return sanitized.data;
  } catch {
    return { name: '', narrative: '', tags: [], editSummary: '' };
  }
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

export const mapWikiEntryRow = (row) => ({
  id: row.id,
  slug: row.slug,
  name: row.name,
  narrative: row.narrative,
  tags: parseWikiTags(row.tags),
  status: row.status,
  currentRevisionId: row.current_revision_id || null,
  versionNumber: Number(row.version_number || 1),
  createdAt: Number(row.created_at || 0),
  updatedAt: Number(row.updated_at || 0),
  deleted: row.deleted === 1,
  deletedAt: row.deleted_at || null,
});

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
