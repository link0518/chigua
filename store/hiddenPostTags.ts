const HIDDEN_POST_TAGS_STORAGE_KEY = 'user:hiddenPostTags:v1';
const HIDDEN_POST_KEYWORDS_STORAGE_KEY = 'user:hiddenPostKeywords:v1';
export const HIDDEN_POST_KEYWORDS_LIMIT = 3;

export const normalizeHiddenPostTag = (value: string) => String(value || '')
  .trim()
  .replace(/^#+/, '')
  .replace(/\s+/g, ' ');

const normalizeHiddenPostTextList = (
  values: Iterable<unknown>,
  normalize: (value: string) => string,
  limit?: number
) => {
  const nextItems: string[] = [];
  const seen = new Set<string>();

  Array.from(values || []).forEach((value) => {
    const normalized = normalize(String(value || ''));
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key) || (typeof limit === 'number' && nextItems.length >= limit)) {
      return;
    }
    seen.add(key);
    nextItems.push(normalized);
  });

  return nextItems;
};

export const normalizeHiddenPostTagList = (values: Iterable<unknown>) => (
  normalizeHiddenPostTextList(values, normalizeHiddenPostTag)
);

export const normalizeHiddenPostKeyword = (value: string) => String(value || '')
  .trim()
  .replace(/\s+/g, ' ');

export const normalizeHiddenPostKeywordList = (values: Iterable<unknown>) => (
  normalizeHiddenPostTextList(values, normalizeHiddenPostKeyword, HIDDEN_POST_KEYWORDS_LIMIT)
);

const readHiddenPostList = (
  storageKey: string,
  normalizeList: (values: Iterable<unknown>) => string[]
) => {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? normalizeList(parsed) : [];
  } catch {
    return [];
  }
};

const writeHiddenPostList = (
  storageKey: string,
  values: string[],
  normalizeList: (values: Iterable<unknown>) => string[]
) => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(storageKey, JSON.stringify(normalizeList(values)));
  } catch {
    // 忽略本地存储失败，避免影响主流程。
  }
};

export const readHiddenPostTags = () => (
  readHiddenPostList(HIDDEN_POST_TAGS_STORAGE_KEY, normalizeHiddenPostTagList)
);

export const writeHiddenPostTags = (tags: string[]) => {
  writeHiddenPostList(HIDDEN_POST_TAGS_STORAGE_KEY, tags, normalizeHiddenPostTagList);
};

export const readHiddenPostKeywords = () => (
  readHiddenPostList(HIDDEN_POST_KEYWORDS_STORAGE_KEY, normalizeHiddenPostKeywordList)
);

export const writeHiddenPostKeywords = (keywords: string[]) => {
  writeHiddenPostList(HIDDEN_POST_KEYWORDS_STORAGE_KEY, keywords, normalizeHiddenPostKeywordList);
};

export const postMatchesHiddenTags = (tags: string[] | undefined, hiddenTags: string[]) => {
  if (!tags?.length || !hiddenTags.length) {
    return false;
  }

  const hiddenTagKeys = new Set(hiddenTags.map((tag) => normalizeHiddenPostTag(tag).toLowerCase()));
  return tags.some((tag) => hiddenTagKeys.has(normalizeHiddenPostTag(tag).toLowerCase()));
};

export const postMatchesHiddenKeywords = (content: string | undefined, hiddenKeywords: string[]) => {
  const normalizedContent = String(content || '').toLowerCase();
  if (!normalizedContent || !hiddenKeywords.length) {
    return false;
  }

  return hiddenKeywords.some((keyword) => {
    const normalizedKeyword = normalizeHiddenPostKeyword(keyword).toLowerCase();
    return Boolean(normalizedKeyword) && normalizedContent.includes(normalizedKeyword);
  });
};

export const postMatchesHiddenFilters = (
  post: { content?: string; tags?: string[] },
  hiddenTags: string[],
  hiddenKeywords: string[]
) => (
  postMatchesHiddenTags(post.tags, hiddenTags)
  || postMatchesHiddenKeywords(post.content, hiddenKeywords)
);
