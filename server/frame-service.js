import {
  BUILTIN_SEED_PACKAGES,
  exportPackageFromRow,
  packageToRowFields,
  publicFrameFromRow,
  validateFramePackage,
  FramePackageError,
} from './frame-package.js';
import {
  normalizePriceTiers,
  resolvePriceTiersFromRow,
  serializePriceTiers,
} from './shop-inventory.js';

let dbRef = null;

export const initFrameService = (db) => {
  dbRef = db;
  db.exec(`
    CREATE TABLE IF NOT EXISTS nickname_frames (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      price INTEGER NOT NULL DEFAULT 0,
      rarity TEXT NOT NULL DEFAULT 'common',
      status TEXT NOT NULL DEFAULT 'on_sale',
      sort INTEGER NOT NULL DEFAULT 100,
      grant_on_register INTEGER NOT NULL DEFAULT 0,
      package_json TEXT NOT NULL DEFAULT '{}',
      theme_css TEXT NOT NULL DEFAULT '',
      package_revision INTEGER NOT NULL DEFAULT 1,
      duration_days INTEGER NOT NULL DEFAULT 0,
      price_tiers TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      created_by TEXT
    );
  `);
  try {
    const cols = db.prepare('PRAGMA table_info(nickname_frames)').all();
    if (!cols.some((c) => c.name === 'duration_days')) {
      db.prepare('ALTER TABLE nickname_frames ADD COLUMN duration_days INTEGER NOT NULL DEFAULT 0').run();
    }
    if (!cols.some((c) => c.name === 'price_tiers')) {
      db.prepare("ALTER TABLE nickname_frames ADD COLUMN price_tiers TEXT NOT NULL DEFAULT '[]'").run();
    }
  } catch {
    // ignore
  }
  seedBuiltinFrames();
};

const getDb = () => {
  if (!dbRef) {
    throw new Error('frame-service 未初始化');
  }
  return dbRef;
};

export const seedBuiltinFrames = () => {
  const db = getDb();
  const now = Date.now();
  const insert = db.prepare(`
    INSERT OR IGNORE INTO nickname_frames (
      id, name, price, rarity, status, sort, grant_on_register,
      package_json, theme_css, package_revision, created_at, updated_at, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const seed of BUILTIN_SEED_PACKAGES) {
    try {
      const pkg = validateFramePackage(seed);
      const fields = packageToRowFields(pkg);
      insert.run(
        fields.id,
        fields.name,
        fields.price,
        fields.rarity,
        fields.status,
        fields.sort,
        fields.grant_on_register,
        fields.package_json,
        fields.theme_css,
        1,
        now,
        now,
        'system'
      );
    } catch {
      // seed 失败忽略单条
    }
  }
};

export const listFrames = ({ includeHidden = true } = {}) => {
  const db = getDb();
  const rows = includeHidden
    ? db.prepare('SELECT * FROM nickname_frames ORDER BY sort ASC, id ASC').all()
    : db.prepare("SELECT * FROM nickname_frames WHERE status != 'hidden' ORDER BY sort ASC, id ASC").all();
  return rows.map(publicFrameFromRow);
};

export const listShopCatalog = () => {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM nickname_frames WHERE status = 'on_sale' ORDER BY sort ASC, id ASC")
    .all();
  return rows.map(publicFrameFromRow);
};

export const getFrameRow = (id) => {
  const db = getDb();
  return db.prepare('SELECT * FROM nickname_frames WHERE id = ?').get(String(id || '').trim()) || null;
};

export const getFramePublic = (id) => publicFrameFromRow(getFrameRow(id));

export const getValidFrameIds = () => {
  const db = getDb();
  return new Set(
    db.prepare("SELECT id FROM nickname_frames WHERE status IN ('on_sale', 'off_sale')").all().map((r) => r.id)
  );
};

export const getOnSaleFrameIds = () => {
  const db = getDb();
  return new Set(
    db.prepare("SELECT id FROM nickname_frames WHERE status = 'on_sale'").all().map((r) => r.id)
  );
};

export const getFrameByIdForPurchase = (frameId) => {
  const row = getFrameRow(frameId);
  if (!row || row.status !== 'on_sale') {
    return null;
  }
  return publicFrameFromRow(row);
};

/** 发帖快照：仅当装备框仍有效（on_sale 或 off_sale 且拥有）时写入 id；此处只校验存在且非 hidden */
export const getEquippedFrameIdIfValid = (frameId) => {
  const id = String(frameId || '').trim();
  if (!id) return null;
  const row = getFrameRow(id);
  if (!row || row.status === 'hidden') return null;
  return row.id;
};

export const listRenderFrames = () => {
  // 展示历史帖需要 off_sale；hidden 不返回
  const db = getDb();
  return db
    .prepare("SELECT * FROM nickname_frames WHERE status != 'hidden' ORDER BY sort ASC")
    .all()
    .map(publicFrameFromRow);
};

export const importFramePackage = (input, { mode = 'create', adminUsername = null } = {}) => {
  const pkg = validateFramePackage(input);
  const fields = packageToRowFields(pkg);
  const db = getDb();
  const existing = getFrameRow(fields.id);
  const now = Date.now();

  if (existing && mode === 'create') {
    throw new FramePackageError(`id 已存在: ${fields.id}`, 'frame.id');
  }

  // 包内可带 priceTiers；否则按单一 price + durationDays 生成
  const frameMeta = pkg.frame || {};
  const durationDays = Math.max(0, Math.trunc(Number(frameMeta.durationDays ?? 0)));
  const priceTiers = normalizePriceTiers(
    frameMeta.priceTiers != null ? frameMeta.priceTiers : [{ price: fields.price, durationDays }],
    fields.price,
    durationDays
  );
  const primary = priceTiers[0] || { price: fields.price, durationDays };
  const price = Number(primary.price);
  const days = Number(primary.durationDays || 0);
  const tiersJson = serializePriceTiers(priceTiers);

  if (existing) {
    const nextRevision = Number(existing.package_revision || 1) + 1;
    db.prepare(`
      UPDATE nickname_frames SET
        name = ?, price = ?, rarity = ?, status = ?, sort = ?, grant_on_register = ?,
        duration_days = ?, price_tiers = ?, package_json = ?, theme_css = ?, package_revision = ?, updated_at = ?
      WHERE id = ?
    `).run(
      fields.name,
      price,
      fields.rarity,
      fields.status,
      fields.sort,
      fields.grant_on_register,
      days,
      tiersJson,
      fields.package_json,
      fields.theme_css,
      nextRevision,
      now,
      fields.id
    );
  } else {
    db.prepare(`
      INSERT INTO nickname_frames (
        id, name, price, rarity, status, sort, grant_on_register,
        duration_days, price_tiers, package_json, theme_css, package_revision, created_at, updated_at, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      fields.id,
      fields.name,
      price,
      fields.rarity,
      fields.status,
      fields.sort,
      fields.grant_on_register,
      days,
      tiersJson,
      fields.package_json,
      fields.theme_css,
      1,
      now,
      now,
      adminUsername || null
    );
  }

  return getFramePublic(fields.id);
};

export const patchFrame = (id, patch = {}) => {
  const row = getFrameRow(id);
  if (!row) {
    return null;
  }

  const existingTiers = resolvePriceTiersFromRow(row);
  let priceTiers = existingTiers;
  if (patch.priceTiers != null) {
    priceTiers = normalizePriceTiers(
      patch.priceTiers,
      patch.price != null ? patch.price : row.price,
      patch.durationDays != null ? patch.durationDays : row.duration_days
    );
  } else if (patch.price != null || patch.durationDays != null) {
    // 仅改单一价格/天数：单档则替换；多档则改首档
    const price = patch.price != null
      ? Number(patch.price)
      : Number(existingTiers[0]?.price ?? row.price);
    const durationDays = patch.durationDays != null
      ? Math.max(0, Math.trunc(Number(patch.durationDays)))
      : Number(existingTiers[0]?.durationDays ?? row.duration_days ?? 0);
    if (existingTiers.length <= 1) {
      priceTiers = normalizePriceTiers([{ price, durationDays }], price, durationDays);
    } else {
      const nextFirst = { ...existingTiers[0], price: Math.trunc(price), durationDays };
      priceTiers = normalizePriceTiers([nextFirst, ...existingTiers.slice(1)], price, durationDays);
    }
  }

  const primary = priceTiers[0] || { price: 0, durationDays: 0 };
  const next = {
    name: patch.name != null ? String(patch.name).trim() : row.name,
    price: Number(primary.price),
    rarity: patch.rarity != null ? String(patch.rarity).trim() : row.rarity,
    status: patch.status != null ? String(patch.status).trim() : row.status,
    sort: patch.sort != null ? Number(patch.sort) : Number(row.sort),
    grant_on_register: patch.grantOnRegister != null
      ? (patch.grantOnRegister ? 1 : 0)
      : Number(row.grant_on_register || 0),
    duration_days: Number(primary.durationDays || 0),
    price_tiers: serializePriceTiers(priceTiers),
  };

  if (!next.name || next.name.length > 16) {
    throw new FramePackageError('名称非法', 'name');
  }
  if (!Number.isInteger(next.price) || next.price < 0 || next.price > 999999) {
    throw new FramePackageError('价格非法', 'price');
  }
  if (!['common', 'rare', 'epic'].includes(next.rarity)) {
    throw new FramePackageError('rarity 非法', 'rarity');
  }
  if (!['on_sale', 'off_sale', 'hidden'].includes(next.status)) {
    throw new FramePackageError('status 非法', 'status');
  }
  if (!Number.isFinite(next.sort)) {
    throw new FramePackageError('sort 非法', 'sort');
  }
  if (!Number.isFinite(next.duration_days) || next.duration_days < 0 || next.duration_days > 3650) {
    throw new FramePackageError('有效期天数非法（0=永久，最大3650）', 'durationDays');
  }
  if (!priceTiers.length) {
    throw new FramePackageError('阶梯定价不能为空', 'priceTiers');
  }

  // 同步 package_json 内 frame 元数据
  let pkg;
  try {
    pkg = JSON.parse(row.package_json || '{}');
  } catch {
    pkg = {};
  }
  pkg.schemaVersion = 2;
  pkg.frame = {
    ...(pkg.frame || {}),
    id: row.id,
    name: next.name,
    price: next.price,
    rarity: next.rarity,
    status: next.status,
    sort: Math.trunc(next.sort),
    grantOnRegister: next.grant_on_register === 1,
    durationDays: next.duration_days,
    priceTiers,
  };

  getDb().prepare(`
    UPDATE nickname_frames SET
      name = ?, price = ?, rarity = ?, status = ?, sort = ?, grant_on_register = ?,
      duration_days = ?, price_tiers = ?, package_json = ?, updated_at = ?
    WHERE id = ?
  `).run(
    next.name,
    next.price,
    next.rarity,
    next.status,
    Math.trunc(next.sort),
    next.grant_on_register,
    next.duration_days,
    next.price_tiers,
    JSON.stringify(pkg),
    Date.now(),
    row.id
  );

  return getFramePublic(row.id);
};

export const exportFrame = (id) => {
  const row = getFrameRow(id);
  if (!row) return null;
  return exportPackageFromRow(row);
};

export { validateFramePackage, FramePackageError, publicFrameFromRow };
