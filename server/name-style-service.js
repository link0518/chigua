/**
 * 炫彩昵称 DB 服务：支持后台 RGB 添加/改价/上下架
 */

import {
  normalizePriceTiers,
  resolvePriceTiersFromRow,
  serializePriceTiers,
} from './shop-inventory.js';

const ID_RE = /^[a-z][a-z0-9-]{1,31}$/;
const RARITIES = new Set(['common', 'rare', 'epic']);
const STATUSES = new Set(['on_sale', 'off_sale', 'hidden']);

let dbRef = null;

export class NameStyleError extends Error {
  constructor(message, path = '') {
    super(message);
    this.name = 'NameStyleError';
    this.path = path;
    this.status = 400;
  }
}

const getDb = () => {
  if (!dbRef) throw new Error('name-style-service 未初始化');
  return dbRef;
};

const clampByte = (value, field) => {
  const i = Math.round(Number(value));
  if (!Number.isFinite(i) || i < 0 || i > 255) {
    throw new NameStyleError(`${field} 须为 0～255 整数`, field);
  }
  return i;
};

const parseRgb = (input) => {
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    return {
      r: clampByte(input.r ?? input.red, 'r'),
      g: clampByte(input.g ?? input.green, 'g'),
      b: clampByte(input.b ?? input.blue, 'b'),
    };
  }
  const text = String(input || '').trim();
  // #RRGGBB
  const hex = text.match(/^#?([0-9a-fA-F]{6})$/);
  if (hex) {
    const h = hex[1];
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
    };
  }
  // rgb( r, g, b ) or r,g,b
  const m = text.replace(/^rgb\s*\(/i, '').replace(/\)$/, '').split(/[\s,]+/).filter(Boolean);
  if (m.length === 3) {
    return {
      r: clampByte(m[0], 'r'),
      g: clampByte(m[1], 'g'),
      b: clampByte(m[2], 'b'),
    };
  }
  throw new NameStyleError('颜色须为 RGB 三元组、rgb(r,g,b) 或 #RRGGBB', 'color');
};

export const rowToPublic = (row) => {
  if (!row) return null;
  const r = Number(row.color_r);
  const g = Number(row.color_g);
  const b = Number(row.color_b);
  const priceTiers = resolvePriceTiersFromRow(row);
  const primary = priceTiers[0] || { price: Number(row.price || 0), durationDays: 0 };
  return {
    id: row.id,
    name: row.name,
    price: Number(primary.price ?? row.price ?? 0),
    rarity: row.rarity || 'common',
    status: row.status || 'on_sale',
    sort: Number(row.sort || 0),
    description: row.description || '',
    /** 有效期（天），0=永久；主档兼容字段 */
    durationDays: Math.max(0, Math.trunc(Number(primary.durationDays ?? row.duration_days ?? 0))),
    /** 阶梯定价 */
    priceTiers,
    styleKey: row.id,
    color: { r, g, b },
    colorCss: `rgb(${r}, ${g}, ${b})`,
    colorHex: `#${[r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('')}`,
  };
};

export const initNameStyleService = (db) => {
  dbRef = db;
  db.exec(`
    CREATE TABLE IF NOT EXISTS name_styles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      price INTEGER NOT NULL DEFAULT 0,
      rarity TEXT NOT NULL DEFAULT 'common',
      status TEXT NOT NULL DEFAULT 'on_sale',
      sort INTEGER NOT NULL DEFAULT 100,
      description TEXT NOT NULL DEFAULT '',
      color_r INTEGER NOT NULL DEFAULT 207,
      color_g INTEGER NOT NULL DEFAULT 19,
      color_b INTEGER NOT NULL DEFAULT 34,
      duration_days INTEGER NOT NULL DEFAULT 0,
      price_tiers TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      created_by TEXT
    );
  `);
  try {
    const cols = db.prepare('PRAGMA table_info(name_styles)').all();
    if (!cols.some((c) => c.name === 'duration_days')) {
      db.prepare('ALTER TABLE name_styles ADD COLUMN duration_days INTEGER NOT NULL DEFAULT 0').run();
    }
    if (!cols.some((c) => c.name === 'price_tiers')) {
      db.prepare("ALTER TABLE name_styles ADD COLUMN price_tiers TEXT NOT NULL DEFAULT '[]'").run();
    }
  } catch {
    // ignore
  }
  seedBuiltinNameStyles();
};

const seedBuiltinNameStyles = () => {
  const db = getDb();
  const now = Date.now();
  // 示例阶梯：10/1天、70/7天
  const defaultTiers = serializePriceTiers(normalizePriceTiers([
    { price: 10, durationDays: 1, label: '1天' },
    { price: 70, durationDays: 7, label: '7天' },
  ], 10, 1));
  db.prepare(`
    INSERT OR IGNORE INTO name_styles (
      id, name, price, rarity, status, sort, description,
      color_r, color_g, color_b, duration_days, price_tiers, created_at, updated_at, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'vip-red',
    '红色昵称',
    10,
    'rare',
    'on_sale',
    10,
    '',
    207,
    19,
    34,
    1,
    defaultTiers,
    now,
    now,
    'system'
  );
  // 兼容旧库：补写阶梯（仅 system 默认且尚无阶梯）
  try {
    const row = db.prepare('SELECT price_tiers, duration_days FROM name_styles WHERE id = ?').get('vip-red');
    const tiersRaw = String(row?.price_tiers || '').trim();
    const emptyTiers = !tiersRaw || tiersRaw === '[]' || tiersRaw === 'null';
    if (emptyTiers) {
      db.prepare(`
        UPDATE name_styles
        SET duration_days = 1, price = 10, price_tiers = ?
        WHERE id = 'vip-red' AND created_by = 'system'
      `).run(defaultTiers);
    }
  } catch {
    // ignore
  }
};

export const listNameStyles = ({ includeHidden = true } = {}) => {
  const db = getDb();
  const rows = includeHidden
    ? db.prepare('SELECT * FROM name_styles ORDER BY sort ASC, id ASC').all()
    : db.prepare("SELECT * FROM name_styles WHERE status != 'hidden' ORDER BY sort ASC, id ASC").all();
  return rows.map(rowToPublic);
};

export const listNameStylesForShop = () => {
  const db = getDb();
  return db
    .prepare("SELECT * FROM name_styles WHERE status = 'on_sale' ORDER BY sort ASC, id ASC")
    .all()
    .map(rowToPublic);
};

/** 渲染用：非 hidden 均可（历史快照） */
export const listNameStylesForRender = () => {
  const db = getDb();
  return db
    .prepare("SELECT * FROM name_styles WHERE status != 'hidden' ORDER BY sort ASC, id ASC")
    .all()
    .map(rowToPublic);
};

export const getNameStyleRow = (id) => (
  getDb().prepare('SELECT * FROM name_styles WHERE id = ?').get(String(id || '').trim()) || null
);

export const getNameStyleById = (id, { forPurchase = false } = {}) => {
  const row = getNameStyleRow(id);
  if (!row) return null;
  if (row.status === 'hidden') return null;
  if (forPurchase && row.status !== 'on_sale') return null;
  return rowToPublic(row);
};

export const getValidNameStyleIds = () => new Set(
  getDb()
    .prepare("SELECT id FROM name_styles WHERE status IN ('on_sale', 'off_sale')")
    .all()
    .map((r) => r.id)
);

export const getEquippedNameStyleIdIfValid = (styleId) => {
  const item = getNameStyleById(styleId);
  return item ? item.id : null;
};

export const parseOwnedNameStyles = (raw) => {
  const valid = getValidNameStyleIds();
  try {
    const parsed = JSON.parse(raw || '[]');
    if (!Array.isArray(parsed)) return [];
    return Array.from(
      new Set(
        parsed
          .map((item) => String(item || '').trim())
          .filter((id) => id && valid.has(id))
      )
    );
  } catch {
    return [];
  }
};

export const createNameStyle = (input, { adminUsername = null } = {}) => {
  const id = String(input?.id || '').trim();
  if (!ID_RE.test(id)) {
    throw new NameStyleError('id 格式非法（^[a-z][a-z0-9-]{1,31}$）', 'id');
  }
  if (getNameStyleRow(id)) {
    throw new NameStyleError(`id 已存在: ${id}`, 'id');
  }
  const name = String(input?.name || '').trim();
  if (!name || name.length > 16) {
    throw new NameStyleError('名称长度 1～16', 'name');
  }
  const price = Number(input?.price);
  if (!Number.isInteger(price) || price < 0 || price > 999999) {
    throw new NameStyleError('价格非法', 'price');
  }
  const rarity = String(input?.rarity || 'common').trim();
  if (!RARITIES.has(rarity)) {
    throw new NameStyleError('rarity 非法', 'rarity');
  }
  const status = String(input?.status || 'on_sale').trim();
  if (!STATUSES.has(status)) {
    throw new NameStyleError('status 非法', 'status');
  }
  const sort = Math.trunc(Number(input?.sort ?? 100));
  if (!Number.isFinite(sort)) {
    throw new NameStyleError('sort 非法', 'sort');
  }
  const description = String(input?.description || '').trim().slice(0, 120);
  const color = parseRgb(input?.color ?? input?.rgb ?? { r: input?.r, g: input?.g, b: input?.b });
  let durationDays = Math.trunc(Number(input?.durationDays ?? 0));
  if (!Number.isFinite(durationDays) || durationDays < 0) durationDays = 0;
  if (durationDays > 3650) durationDays = 3650;

  const priceTiers = normalizePriceTiers(
    input?.priceTiers != null ? input.priceTiers : [{ price, durationDays }],
    price,
    durationDays
  );
  const primary = priceTiers[0] || { price, durationDays };

  const now = Date.now();
  getDb().prepare(`
    INSERT INTO name_styles (
      id, name, price, rarity, status, sort, description,
      color_r, color_g, color_b, duration_days, price_tiers, created_at, updated_at, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    name,
    Number(primary.price),
    rarity,
    status,
    sort,
    description,
    color.r,
    color.g,
    color.b,
    Number(primary.durationDays || 0),
    serializePriceTiers(priceTiers),
    now,
    now,
    adminUsername || null
  );

  return getNameStyleById(id);
};

export const patchNameStyle = (id, patch = {}) => {
  const row = getNameStyleRow(id);
  if (!row) return null;

  let name = row.name;
  let rarity = row.rarity;
  let status = row.status;
  let sort = Number(row.sort);
  let description = row.description || '';
  let r = Number(row.color_r);
  let g = Number(row.color_g);
  let b = Number(row.color_b);

  const existingTiers = resolvePriceTiersFromRow(row);
  let priceTiers = existingTiers;

  if (patch.name != null) {
    name = String(patch.name).trim();
    if (!name || name.length > 16) throw new NameStyleError('名称非法', 'name');
  }
  if (patch.rarity != null) {
    rarity = String(patch.rarity).trim();
    if (!RARITIES.has(rarity)) throw new NameStyleError('rarity 非法', 'rarity');
  }
  if (patch.status != null) {
    status = String(patch.status).trim();
    if (!STATUSES.has(status)) throw new NameStyleError('status 非法', 'status');
  }
  if (patch.sort != null) {
    sort = Math.trunc(Number(patch.sort));
    if (!Number.isFinite(sort)) throw new NameStyleError('sort 非法', 'sort');
  }
  if (patch.description != null) {
    description = String(patch.description).trim().slice(0, 120);
  }
  if (patch.color != null || patch.rgb != null || patch.r != null || patch.g != null || patch.b != null) {
    const color = parseRgb(
      patch.color ?? patch.rgb ?? { r: patch.r ?? r, g: patch.g ?? g, b: patch.b ?? b }
    );
    r = color.r;
    g = color.g;
    b = color.b;
  }

  if (patch.priceTiers != null) {
    priceTiers = normalizePriceTiers(
      patch.priceTiers,
      patch.price != null ? patch.price : row.price,
      patch.durationDays != null ? patch.durationDays : row.duration_days
    );
  } else if (patch.price != null || patch.durationDays != null) {
    const price = patch.price != null
      ? Number(patch.price)
      : Number(existingTiers[0]?.price ?? row.price);
    if (!Number.isInteger(price) || price < 0 || price > 999999) {
      throw new NameStyleError('价格非法', 'price');
    }
    const durationDays = patch.durationDays != null
      ? Math.trunc(Number(patch.durationDays))
      : Number(existingTiers[0]?.durationDays ?? row.duration_days ?? 0);
    if (!Number.isFinite(durationDays) || durationDays < 0 || durationDays > 3650) {
      throw new NameStyleError('有效期天数非法（0=永久，最大3650）', 'durationDays');
    }
    if (existingTiers.length <= 1) {
      priceTiers = normalizePriceTiers([{ price, durationDays }], price, durationDays);
    } else {
      priceTiers = normalizePriceTiers(
        [{ ...existingTiers[0], price, durationDays }, ...existingTiers.slice(1)],
        price,
        durationDays
      );
    }
  }

  if (!priceTiers.length) {
    throw new NameStyleError('阶梯定价不能为空', 'priceTiers');
  }
  const primary = priceTiers[0];
  const price = Number(primary.price);
  const durationDays = Number(primary.durationDays || 0);

  getDb().prepare(`
    UPDATE name_styles SET
      name = ?, price = ?, rarity = ?, status = ?, sort = ?, description = ?,
      color_r = ?, color_g = ?, color_b = ?, duration_days = ?, price_tiers = ?, updated_at = ?
    WHERE id = ?
  `).run(
    name,
    price,
    rarity,
    status,
    sort,
    description,
    r,
    g,
    b,
    durationDays,
    serializePriceTiers(priceTiers),
    Date.now(),
    row.id
  );

  return getNameStyleById(row.id) || rowToPublic(getNameStyleRow(row.id));
};
