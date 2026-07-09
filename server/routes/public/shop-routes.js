import {
  DAILY_CLAIM_COINS as DEFAULT_DAILY_CLAIM_COINS,
  ensureDefaultOwned,
  getFrameById,
  getShopCatalogItems,
} from '../../shop-catalog.js';
import { getFramePublic, getValidFrameIds } from '../../frame-service.js';
import {
  getNameStyleById,
  getValidNameStyleIds,
  listNameStylesForShop,
} from '../../name-style-catalog.js';
import {
  addOrExtendOwnership,
  filterActiveOwnership,
  findOwnership,
  ownershipIds,
  parseOwnershipList,
  pickPriceTier,
  serializeOwnershipList,
} from '../../shop-inventory.js';

export const registerPublicShopRoutes = (app, deps) => {
  const {
    db,
    requireFingerprint,
    formatDateKey,
    getShopEnabled = () => true,
    getShopDailyClaimCoins = () => DEFAULT_DAILY_CLAIM_COINS,
  } = deps;

  const resolveDailyClaimCoins = () => {
    if (typeof getShopDailyClaimCoins !== 'function') {
      return DEFAULT_DAILY_CLAIM_COINS;
    }
    const n = Math.trunc(Number(getShopDailyClaimCoins()));
    if (!Number.isFinite(n) || n < 0) return DEFAULT_DAILY_CLAIM_COINS;
    return Math.min(n, 100000);
  };

  const assertShopOpen = (res) => {
    if (typeof getShopEnabled === 'function' && !getShopEnabled()) {
      res.status(403).json({ error: '商城暂未开放' });
      return false;
    }
    return true;
  };

  const getOrCreateProfile = (identityKey) => {
    const key = String(identityKey || '').trim();
    if (!key) return null;
    const now = Date.now();

    let row = db.prepare('SELECT * FROM user_cosmetics WHERE identity_key = ?').get(key);
    if (!row) {
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
      row = db.prepare('SELECT * FROM user_cosmetics WHERE identity_key = ?').get(key);
    }

    const validFrameIds = getValidFrameIds();
    const validNameStyleIds = getValidNameStyleIds();

    let frameOwned = filterActiveOwnership(parseOwnershipList(row.owned_frames_json), now)
      .filter((item) => validFrameIds.has(item.id));
    frameOwned = ensureDefaultOwned(frameOwned);

    let nameOwned = filterActiveOwnership(parseOwnershipList(row.owned_name_styles_json), now)
      .filter((item) => validNameStyleIds.has(item.id));

    let equippedFrameId = row.equipped_frame_id || null;
    if (equippedFrameId && !ownershipIds(frameOwned).includes(equippedFrameId)) {
      equippedFrameId = null;
    }
    if (equippedFrameId && !validFrameIds.has(equippedFrameId)) {
      equippedFrameId = null;
    }

    let equippedNameStyleId = row.equipped_name_style_id || null;
    if (equippedNameStyleId && !ownershipIds(nameOwned).includes(equippedNameStyleId)) {
      equippedNameStyleId = null;
    }
    if (equippedNameStyleId && !validNameStyleIds.has(equippedNameStyleId)) {
      equippedNameStyleId = null;
    }

    const nextFramesJson = serializeOwnershipList(frameOwned);
    const nextNamesJson = serializeOwnershipList(nameOwned);
    const changed = nextFramesJson !== String(row.owned_frames_json || '[]')
      || nextNamesJson !== String(row.owned_name_styles_json || '[]')
      || equippedFrameId !== (row.equipped_frame_id || null)
      || equippedNameStyleId !== (row.equipped_name_style_id || null);

    if (changed) {
      db.prepare(
        `
        UPDATE user_cosmetics
        SET owned_frames_json = ?, equipped_frame_id = ?,
            owned_name_styles_json = ?, equipped_name_style_id = ?,
            updated_at = ?
        WHERE identity_key = ?
        `
      ).run(
        nextFramesJson,
        equippedFrameId,
        nextNamesJson,
        equippedNameStyleId,
        now,
        key
      );
      row = {
        ...row,
        owned_frames_json: nextFramesJson,
        equipped_frame_id: equippedFrameId,
        owned_name_styles_json: nextNamesJson,
        equipped_name_style_id: equippedNameStyleId,
      };
    }

    return {
      identityKey: key,
      coins: Math.max(0, Number(row.coins || 0)),
      ownedFrames: frameOwned,
      ownedFrameIds: ownershipIds(frameOwned),
      equippedFrameId,
      ownedNameStyles: nameOwned,
      ownedNameStyleIds: ownershipIds(nameOwned),
      equippedNameStyleId,
      lastDailyClaimDate: row.last_daily_claim_date || null,
      updatedAt: Number(row.updated_at || 0),
    };
  };

  const mergeOwnedInventoryItems = (shopItems, ownedIds, getItemById) => {
    const byId = new Map();
    (shopItems || []).forEach((item) => {
      if (item?.id) byId.set(item.id, item);
    });
    (ownedIds || []).forEach((id) => {
      const key = String(id || '').trim();
      if (!key || byId.has(key)) return;
      const item = getItemById(key);
      if (item?.id) byId.set(item.id, item);
    });
    return Array.from(byId.values())
      .sort((a, b) => Number(a.sort || 0) - Number(b.sort || 0) || String(a.id).localeCompare(String(b.id)));
  };

  const buildShopPayload = (profile) => {
    const today = formatDateKey();
    const catalog = mergeOwnedInventoryItems(getShopCatalogItems(), profile.ownedFrameIds, getFramePublic);
    const nameStyles = mergeOwnedInventoryItems(listNameStylesForShop(), profile.ownedNameStyleIds, getNameStyleById);

    return {
      shopEnabled: true,
      coins: profile.coins,
      ownedFrameIds: profile.ownedFrameIds,
      equippedFrameId: profile.equippedFrameId,
      ownedNameStyleIds: profile.ownedNameStyleIds,
      equippedNameStyleId: profile.equippedNameStyleId,
      ownedFramesMeta: profile.ownedFrames,
      ownedNameStylesMeta: profile.ownedNameStyles,
      canClaimDaily: profile.lastDailyClaimDate !== today,
      dailyClaimCoins: resolveDailyClaimCoins(),
      catalog: catalog.map((item) => {
        const own = findOwnership(profile.ownedFrames, item.id);
        const priceTiers = Array.isArray(item.priceTiers) ? item.priceTiers : [];
        return {
          id: item.id,
          name: item.name,
          price: item.price,
          rarity: item.rarity,
          durationDays: item.durationDays || 0,
          priceTiers,
          owned: Boolean(own),
          expiresAt: own?.expiresAt ?? null,
          equipped: profile.equippedFrameId === item.id,
          render: item.render,
          packageRevision: item.packageRevision,
        };
      }),
      nameStyles: nameStyles.map((item) => {
        const own = findOwnership(profile.ownedNameStyles, item.id);
        const priceTiers = Array.isArray(item.priceTiers) ? item.priceTiers : [];
        return {
          id: item.id,
          name: item.name,
          price: item.price,
          rarity: item.rarity,
          description: item.description,
          durationDays: item.durationDays || 0,
          priceTiers,
          styleKey: item.styleKey,
          color: item.color,
          colorCss: item.colorCss,
          colorHex: item.colorHex,
          owned: Boolean(own),
          expiresAt: own?.expiresAt ?? null,
          equipped: profile.equippedNameStyleId === item.id,
        };
      }),
    };
  };

  app.get('/api/me/shop', (req, res) => {
    if (!assertShopOpen(res)) return;
    const fingerprint = requireFingerprint(req, res);
    if (!fingerprint) return;
    return res.json(buildShopPayload(getOrCreateProfile(fingerprint)));
  });

  app.post('/api/me/shop/claim-daily', (req, res) => {
    if (!assertShopOpen(res)) return;
    const fingerprint = requireFingerprint(req, res);
    if (!fingerprint) return;

    const profile = getOrCreateProfile(fingerprint);
    const today = formatDateKey();
    if (profile.lastDailyClaimDate === today) {
      return res.status(400).json({ error: '今日已领取瓜子' });
    }

    const claimAmount = resolveDailyClaimCoins();
    db.prepare(
      `
      UPDATE user_cosmetics
      SET coins = ?, last_daily_claim_date = ?, updated_at = ?
      WHERE identity_key = ?
      `
    ).run(profile.coins + claimAmount, today, Date.now(), fingerprint);

    return res.json({
      ...buildShopPayload(getOrCreateProfile(fingerprint)),
      claimed: claimAmount,
    });
  });

  app.post('/api/me/shop/redeem', (req, res) => {
    if (!assertShopOpen(res)) return;
    const fingerprint = requireFingerprint(req, res);
    if (!fingerprint) return;

    const frameId = String(req.body?.frameId || '').trim();
    const frame = getFrameById(frameId);
    if (!frame) {
      return res.status(400).json({ error: '商品不存在或已下架' });
    }

    const tiers = Array.isArray(frame.priceTiers) && frame.priceTiers.length
      ? frame.priceTiers
      : [{ id: 'default', price: frame.price, durationDays: frame.durationDays || 0, label: '' }];
    const tier = pickPriceTier(tiers, req.body?.tierId);
    if (!tier) {
      return res.status(400).json({ error: '请选择有效的价格档位' });
    }

    const profile = getOrCreateProfile(fingerprint);
    const durationDays = Number(tier.durationDays || 0);
    const permanent = !durationDays;
    const already = findOwnership(profile.ownedFrames, frame.id);

    // 永久商品不可重复购买
    if (permanent && already) {
      return res.status(400).json({ error: '已拥有该昵称框' });
    }
    if (profile.coins < tier.price) {
      return res.status(400).json({ error: '瓜子不足' });
    }

    const nextOwned = ensureDefaultOwned(
      addOrExtendOwnership(profile.ownedFrames, frame.id, durationDays)
    );
    db.prepare(
      `
      UPDATE user_cosmetics
      SET coins = ?, owned_frames_json = ?, updated_at = ?
      WHERE identity_key = ?
      `
    ).run(profile.coins - tier.price, serializeOwnershipList(nextOwned), Date.now(), fingerprint);

    return res.json(buildShopPayload(getOrCreateProfile(fingerprint)));
  });

  app.post('/api/me/shop/equip', (req, res) => {
    if (!assertShopOpen(res)) return;
    const fingerprint = requireFingerprint(req, res);
    if (!fingerprint) return;

    const rawFrameId = req.body?.frameId;
    const frameId = rawFrameId === null || rawFrameId === undefined || rawFrameId === ''
      ? null
      : String(rawFrameId).trim();

    const profile = getOrCreateProfile(fingerprint);
    const validIds = getValidFrameIds();

    if (frameId) {
      if (!validIds.has(frameId)) {
        return res.status(400).json({ error: '昵称框不存在' });
      }
      if (!profile.ownedFrameIds.includes(frameId)) {
        return res.status(400).json({ error: '尚未拥有该昵称框或已过期' });
      }
    }

    db.prepare(
      `
      UPDATE user_cosmetics
      SET equipped_frame_id = ?, updated_at = ?
      WHERE identity_key = ?
      `
    ).run(frameId, Date.now(), fingerprint);

    return res.json(buildShopPayload(getOrCreateProfile(fingerprint)));
  });

  app.post('/api/me/shop/name-styles/redeem', (req, res) => {
    if (!assertShopOpen(res)) return;
    const fingerprint = requireFingerprint(req, res);
    if (!fingerprint) return;

    const styleId = String(req.body?.styleId || '').trim();
    const style = getNameStyleById(styleId, { forPurchase: true });
    if (!style) {
      return res.status(400).json({ error: '炫彩昵称不存在或已下架' });
    }

    const tiers = Array.isArray(style.priceTiers) && style.priceTiers.length
      ? style.priceTiers
      : [{ id: 'default', price: style.price, durationDays: style.durationDays || 0, label: '' }];
    const tier = pickPriceTier(tiers, req.body?.tierId);
    if (!tier) {
      return res.status(400).json({ error: '请选择有效的价格档位' });
    }

    const profile = getOrCreateProfile(fingerprint);
    const durationDays = Number(tier.durationDays || 0);
    const permanent = !durationDays;
    const already = findOwnership(profile.ownedNameStyles, style.id);

    if (permanent && already) {
      return res.status(400).json({ error: '已拥有该炫彩昵称' });
    }
    if (profile.coins < tier.price) {
      return res.status(400).json({ error: '瓜子不足' });
    }

    const nextOwned = addOrExtendOwnership(profile.ownedNameStyles, style.id, durationDays);
    db.prepare(
      `
      UPDATE user_cosmetics
      SET coins = ?, owned_name_styles_json = ?, updated_at = ?
      WHERE identity_key = ?
      `
    ).run(profile.coins - tier.price, serializeOwnershipList(nextOwned), Date.now(), fingerprint);

    return res.json(buildShopPayload(getOrCreateProfile(fingerprint)));
  });

  app.post('/api/me/shop/name-styles/equip', (req, res) => {
    if (!assertShopOpen(res)) return;
    const fingerprint = requireFingerprint(req, res);
    if (!fingerprint) return;

    const raw = req.body?.styleId;
    const styleId = raw === null || raw === undefined || raw === ''
      ? null
      : String(raw).trim();

    const profile = getOrCreateProfile(fingerprint);
    if (styleId) {
      if (!getValidNameStyleIds().has(styleId)) {
        return res.status(400).json({ error: '炫彩昵称不存在' });
      }
      if (!profile.ownedNameStyleIds.includes(styleId)) {
        return res.status(400).json({ error: '尚未拥有该炫彩昵称或已过期' });
      }
    }

    db.prepare(
      `
      UPDATE user_cosmetics
      SET equipped_name_style_id = ?, updated_at = ?
      WHERE identity_key = ?
      `
    ).run(styleId, Date.now(), fingerprint);

    return res.json(buildShopPayload(getOrCreateProfile(fingerprint)));
  });
};

export const authorFrameSelectSql = (fingerprintColumn) => (
  `(SELECT equipped_frame_id FROM user_cosmetics WHERE identity_key = ${fingerprintColumn} LIMIT 1) AS author_frame_id`
);
