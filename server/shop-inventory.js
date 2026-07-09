/** 商城库存：支持限时商品 { id, expiresAt }，兼容旧版纯 id 数组 */

export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * @returns {Array<{ id: string, expiresAt: number|null }>}
 */
export const parseOwnershipList = (raw) => {
  try {
    const parsed = JSON.parse(raw || '[]');
    if (!Array.isArray(parsed)) return [];
    const out = [];
    const seen = new Set();
    for (const item of parsed) {
      if (typeof item === 'string') {
        const id = item.trim();
        if (!id || seen.has(id)) continue;
        seen.add(id);
        out.push({ id, expiresAt: null });
        continue;
      }
      if (item && typeof item === 'object') {
        const id = String(item.id || '').trim();
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const exp = item.expiresAt == null || item.expiresAt === ''
          ? null
          : Number(item.expiresAt);
        out.push({
          id,
          expiresAt: Number.isFinite(exp) && exp > 0 ? exp : null,
        });
      }
    }
    return out;
  } catch {
    return [];
  }
};

export const serializeOwnershipList = (items) => JSON.stringify(
  (items || []).map((item) => ({
    id: item.id,
    expiresAt: item.expiresAt == null ? null : Number(item.expiresAt),
  }))
);

/** 去掉已过期 */
export const filterActiveOwnership = (items, now = Date.now()) => (
  (items || []).filter((item) => {
    if (!item?.id) return false;
    if (item.expiresAt == null) return true;
    return Number(item.expiresAt) > now;
  })
);

export const ownershipIds = (items) => (items || []).map((item) => item.id);

/**
 * 兑换/续期：durationDays <= 0 或 null 为永久
 * 限时：从未拥有则 now+days；已拥有且未过期则从当前到期时间续期
 */
export const addOrExtendOwnership = (items, id, durationDays, now = Date.now()) => {
  const key = String(id || '').trim();
  if (!key) return filterActiveOwnership(items, now);

  const active = filterActiveOwnership(items, now).filter((item) => item.id !== key);
  const days = durationDays == null ? 0 : Number(durationDays);
  const permanent = !Number.isFinite(days) || days <= 0;

  if (permanent) {
    active.push({ id: key, expiresAt: null });
    return active;
  }

  const prev = filterActiveOwnership(items, now).find((item) => item.id === key);
  const base = prev?.expiresAt && Number(prev.expiresAt) > now
    ? Number(prev.expiresAt)
    : now;
  active.push({ id: key, expiresAt: base + Math.trunc(days) * DAY_MS });
  return active;
};

export const findOwnership = (items, id) => {
  const key = String(id || '').trim();
  return (items || []).find((item) => item.id === key) || null;
};

export const normalizeDurationDays = (value) => {
  if (value == null || value === '') return 0;
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n) || n < 0) return 0;
  if (n > 3650) return 3650; // max ~10 years
  return n;
};

const MAX_PRICE_TIERS = 8;

/** 时长文案：1天 / 7天 / 永久 */
export const formatDurationLabel = (durationDays) => {
  const days = normalizeDurationDays(durationDays);
  if (days <= 0) return '永久';
  if (days === 7) return '7天';
  if (days === 30) return '30天';
  return `${days}天`;
};

export const makeTierId = (durationDays, index = 0) => {
  const days = normalizeDurationDays(durationDays);
  const base = days <= 0 ? 'perm' : `${days}d`;
  return index > 0 ? `${base}-${index}` : base;
};

/**
 * 规范化阶梯定价。
 * 输入可为数组 [{ price, durationDays, label?, id? }] 或 JSON 字符串。
 * 若为空，回退为单一档：fallbackPrice / fallbackDurationDays。
 * @returns {Array<{ id: string, price: number, durationDays: number, label: string }>}
 */
export const normalizePriceTiers = (input, fallbackPrice = 0, fallbackDurationDays = 0) => {
  let source = input;
  if (typeof source === 'string') {
    const raw = source.trim();
    if (!raw) {
      source = [];
    } else {
      try {
        source = JSON.parse(raw);
      } catch {
        // 支持多行文本：10/1  70/7  500/0
        source = raw.split(/[\r\n]+/).map((line) => line.trim()).filter(Boolean).map((line) => {
          const m = line.match(/^(\d+)\s*[\/|]\s*(\d+)\s*(天|日|d|days?)?$/i)
            || line.match(/^(\d+)\s*[\/|]\s*(永久|perm|permanent)$/i);
          if (m && m[2] && /永久|perm/i.test(String(m[2]))) {
            return { price: Number(m[1]), durationDays: 0 };
          }
          if (m) {
            return { price: Number(m[1]), durationDays: Number(m[2]) };
          }
          return null;
        }).filter(Boolean);
      }
    }
  }

  const out = [];
  const seen = new Set();
  const list = Array.isArray(source) ? source : [];

  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const price = Math.trunc(Number(item.price));
    if (!Number.isFinite(price) || price < 0 || price > 999999) continue;
    const durationDays = normalizeDurationDays(item.durationDays ?? item.days ?? 0);
    let id = String(item.id || '').trim();
    if (!id || !/^[a-zA-Z0-9_-]{1,32}$/.test(id) || seen.has(id)) {
      id = makeTierId(durationDays, out.length);
      let n = 0;
      while (seen.has(id)) {
        n += 1;
        id = makeTierId(durationDays, out.length + n);
      }
    }
    seen.add(id);
    const label = String(item.label || '').trim().slice(0, 16) || formatDurationLabel(durationDays);
    out.push({ id, price, durationDays, label });
    if (out.length >= MAX_PRICE_TIERS) break;
  }

  if (out.length === 0) {
    const price = Math.max(0, Math.trunc(Number(fallbackPrice) || 0));
    const durationDays = normalizeDurationDays(fallbackDurationDays);
    out.push({
      id: makeTierId(durationDays, 0),
      price,
      durationDays,
      label: formatDurationLabel(durationDays),
    });
  }

  // 按时长升序，永久放最后
  out.sort((a, b) => {
    const da = a.durationDays <= 0 ? 99999 : a.durationDays;
    const db = b.durationDays <= 0 ? 99999 : b.durationDays;
    if (da !== db) return da - db;
    return a.price - b.price;
  });

  return out;
};

/** 从 DB 行解析阶梯（兼容仅 price + duration_days） */
export const resolvePriceTiersFromRow = (row) => {
  if (!row) {
    return normalizePriceTiers([], 0, 0);
  }
  return normalizePriceTiers(
    row.price_tiers ?? row.priceTiers,
    row.price,
    row.duration_days ?? row.durationDays
  );
};

export const pickPriceTier = (tiers, tierId) => {
  const list = Array.isArray(tiers) ? tiers : [];
  if (!list.length) return null;
  const key = String(tierId || '').trim();
  if (key) {
    const found = list.find((t) => t.id === key);
    if (found) return found;
  }
  return list[0];
};

/** 文本编辑格式：每行 价格/天数 */
export const priceTiersToText = (tiers) => (
  (tiers || []).map((t) => `${t.price}/${t.durationDays}`).join('\n')
);

export const serializePriceTiers = (tiers) => JSON.stringify(
  (tiers || []).map((t) => ({
    id: t.id,
    price: t.price,
    durationDays: t.durationDays,
    label: t.label,
  }))
);
