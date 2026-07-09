import { ensureDefaultOwned } from '../../shop-catalog.js';
import {
  ownershipIds,
  parseOwnershipList,
  serializeOwnershipList,
} from '../../shop-inventory.js';

const COINS_MAX = 10_000_000;

/**
 * 商城管理：按指纹查瓜子、增减瓜子
 */
export const registerAdminShopRoutes = (app, deps) => {
  const {
    db,
    requireAdmin,
    requireAdminCsrf,
    requireAdminRead = (_req, _res, next) => next(),
    requireAdminManage = (_req, _res, next) => next(),
    logAdminAction,
  } = deps;

  const normalizeIdentityKey = (value) => String(value || '').trim();

  const readProfile = (identityKey) => {
    const key = normalizeIdentityKey(identityKey);
    if (!key) return null;
    const row = db.prepare('SELECT * FROM user_cosmetics WHERE identity_key = ?').get(key);
    if (!row) {
      return {
        identityKey: key,
        exists: false,
        coins: 0,
        ownedFrameIds: [],
        ownedNameStyleIds: [],
        equippedFrameId: null,
        equippedNameStyleId: null,
        lastDailyClaimDate: null,
        updatedAt: 0,
      };
    }
    const frames = parseOwnershipList(row.owned_frames_json);
    const names = parseOwnershipList(row.owned_name_styles_json);
    return {
      identityKey: key,
      exists: true,
      coins: Math.max(0, Number(row.coins || 0)),
      ownedFrameIds: ownershipIds(frames),
      ownedNameStyleIds: ownershipIds(names),
      equippedFrameId: row.equipped_frame_id || null,
      equippedNameStyleId: row.equipped_name_style_id || null,
      lastDailyClaimDate: row.last_daily_claim_date || null,
      updatedAt: Number(row.updated_at || 0),
    };
  };

  const ensureProfileRow = (identityKey) => {
    const key = normalizeIdentityKey(identityKey);
    if (!key) return null;
    let row = db.prepare('SELECT * FROM user_cosmetics WHERE identity_key = ?').get(key);
    if (row) return row;
    const now = Date.now();
    const owned = ensureDefaultOwned([]);
    db.prepare(
      `
      INSERT INTO user_cosmetics (
        identity_key, coins, owned_frames_json, equipped_frame_id,
        owned_name_styles_json, equipped_name_style_id,
        last_daily_claim_date, updated_at
      ) VALUES (?, 0, ?, NULL, ?, NULL, NULL, ?)
      `
    ).run(key, serializeOwnershipList(owned), serializeOwnershipList([]), now);
    return db.prepare('SELECT * FROM user_cosmetics WHERE identity_key = ?').get(key);
  };

  /** GET /api/admin/shop/users?fingerprint= */
  app.get('/api/admin/shop/users', requireAdmin, requireAdminRead, (req, res) => {
    const fingerprint = normalizeIdentityKey(
      req.query?.fingerprint || req.query?.identityKey || req.query?.identity_key
    );
    if (!fingerprint) {
      return res.status(400).json({ error: '请提供 fingerprint（用户身份指纹）' });
    }
    return res.json({ user: readProfile(fingerprint) });
  });

  /**
   * POST /api/admin/shop/users/coins
   * body: { fingerprint, delta } 增减；或 { fingerprint, coins } 设为绝对值
   */
  app.post('/api/admin/shop/users/coins', requireAdmin, requireAdminCsrf, requireAdminManage, (req, res) => {
    const fingerprint = normalizeIdentityKey(
      req.body?.fingerprint || req.body?.identityKey || req.body?.identity_key
    );
    if (!fingerprint) {
      return res.status(400).json({ error: '请提供 fingerprint（用户身份指纹）' });
    }

    const hasDelta = Object.prototype.hasOwnProperty.call(req.body || {}, 'delta');
    const hasCoins = Object.prototype.hasOwnProperty.call(req.body || {}, 'coins');
    if (!hasDelta && !hasCoins) {
      return res.status(400).json({ error: '请提供 delta（增减）或 coins（设为绝对值）' });
    }
    if (hasDelta && hasCoins) {
      return res.status(400).json({ error: 'delta 与 coins 只能二选一' });
    }

    const beforeRow = ensureProfileRow(fingerprint);
    if (!beforeRow) {
      return res.status(400).json({ error: '指纹无效' });
    }
    const beforeCoins = Math.max(0, Number(beforeRow.coins || 0));
    let nextCoins = beforeCoins;

    if (hasDelta) {
      const delta = Math.trunc(Number(req.body.delta));
      if (!Number.isFinite(delta) || delta === 0) {
        return res.status(400).json({ error: 'delta 须为非 0 整数' });
      }
      if (Math.abs(delta) > COINS_MAX) {
        return res.status(400).json({ error: `单次增减不能超过 ${COINS_MAX}` });
      }
      nextCoins = beforeCoins + delta;
    } else {
      nextCoins = Math.trunc(Number(req.body.coins));
      if (!Number.isFinite(nextCoins)) {
        return res.status(400).json({ error: 'coins 须为整数' });
      }
    }

    nextCoins = Math.min(Math.max(0, nextCoins), COINS_MAX);
    const now = Date.now();
    db.prepare(
      `
      UPDATE user_cosmetics
      SET coins = ?, updated_at = ?
      WHERE identity_key = ?
      `
    ).run(nextCoins, now, fingerprint);

    const after = readProfile(fingerprint);
    logAdminAction(req, {
      action: 'shop_coins_adjust',
      targetType: 'user_cosmetics',
      targetId: fingerprint,
      before: { coins: beforeCoins },
      after: { coins: after.coins },
      reason: hasDelta
        ? `delta=${Math.trunc(Number(req.body.delta))}`
        : `setCoins=${Math.trunc(Number(req.body.coins))}`,
    });

    return res.json({
      user: after,
      beforeCoins,
      afterCoins: after.coins,
      delta: after.coins - beforeCoins,
    });
  });
};
