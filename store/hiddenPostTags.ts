const HIDDEN_POST_TAGS_STORAGE_KEY = 'user:hiddenPostTags:v1';

export const normalizeHiddenPostTag = (value: string) => String(value || '')
  .trim()
  .replace(/^#+/, '')
  .replace(/\s+/g, ' ');

export const normalizeHiddenPostTagList = (values: Iterable<unknown>) => {
  const nextTags: string[] = [];
  const seen = new Set<string>();

  Array.from(values || []).forEach((value) => {
    const normalized = normalizeHiddenPostTag(String(value || ''));
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) {
      return;
    }
    seen.add(key);
    nextTags.push(normalized);
  });

  return nextTags;
};

export const readHiddenPostTags = () => {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(HIDDEN_POST_TAGS_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? normalizeHiddenPostTagList(parsed) : [];
  } catch {
    return [];
  }
};

export const writeHiddenPostTags = (tags: string[]) => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(
      HIDDEN_POST_TAGS_STORAGE_KEY,
      JSON.stringify(normalizeHiddenPostTagList(tags))
    );
  } catch {
    // 忽略本地存储失败，避免影响主流程。
  }
};

export const postMatchesHiddenTags = (tags: string[] | undefined, hiddenTags: string[]) => {
  if (!tags?.length || !hiddenTags.length) {
    return false;
  }

  const hiddenTagKeys = new Set(hiddenTags.map((tag) => normalizeHiddenPostTag(tag).toLowerCase()));
  return tags.some((tag) => hiddenTagKeys.has(normalizeHiddenPostTag(tag).toLowerCase()));
};
