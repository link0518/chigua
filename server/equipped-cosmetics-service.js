import { getEquippedFrameIdIfValid } from './frame-service.js';
import { getEquippedNameStyleIdIfValid } from './name-style-catalog.js';
import { ensureDefaultOwned } from './shop-catalog.js';
import { filterActiveOwnership, parseOwnershipList } from './shop-inventory.js';

const normalizeIdentityKey = (identityKey) => String(identityKey || '').trim();

const hasOwnership = (ownedItems, itemId) => (
  (ownedItems || []).some((item) => item?.id === itemId)
);

/**
 * 创建当前有效装扮解析器。
 * 发帖和评论只能使用仍在目录中、当前拥有且尚未过期的装扮。
 */
export const createEquippedCosmeticsService = (db) => {
  if (!db) {
    throw new Error('缺少装扮服务数据库实例');
  }

  const getEquippedFrameIdForIdentity = (identityKey) => {
    const key = normalizeIdentityKey(identityKey);
    if (!key) return null;

    const row = db
      .prepare(`
        SELECT owned_frames_json, equipped_frame_id
        FROM user_cosmetics
        WHERE identity_key = ?
        LIMIT 1
      `)
      .get(key);
    const equippedFrameId = getEquippedFrameIdIfValid(row?.equipped_frame_id || null);
    if (!equippedFrameId) return null;

    // 与商城保持一致：先剔除过期记录，再补齐注册时默认赠送的头像框。
    const ownedFrames = ensureDefaultOwned(
      filterActiveOwnership(parseOwnershipList(row?.owned_frames_json))
    );
    return hasOwnership(ownedFrames, equippedFrameId) ? equippedFrameId : null;
  };

  const getEquippedNameStyleIdForIdentity = (identityKey) => {
    const key = normalizeIdentityKey(identityKey);
    if (!key) return null;

    const row = db
      .prepare(`
        SELECT owned_name_styles_json, equipped_name_style_id
        FROM user_cosmetics
        WHERE identity_key = ?
        LIMIT 1
      `)
      .get(key);
    const equippedNameStyleId = getEquippedNameStyleIdIfValid(row?.equipped_name_style_id || null);
    if (!equippedNameStyleId) return null;

    const ownedNameStyles = filterActiveOwnership(
      parseOwnershipList(row?.owned_name_styles_json)
    );
    return hasOwnership(ownedNameStyles, equippedNameStyleId) ? equippedNameStyleId : null;
  };

  return {
    getEquippedFrameIdForIdentity,
    getEquippedNameStyleIdForIdentity,
  };
};
