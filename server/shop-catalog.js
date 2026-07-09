/**
 * 商城目录兼容层：商品数据以 nickname_frames 表为准（frame-service）。
 */
import {
  getFrameByIdForPurchase,
  getOnSaleFrameIds,
  getValidFrameIds,
  listShopCatalog,
} from './frame-service.js';
import {
  filterActiveOwnership,
  ownershipIds,
  parseOwnershipList,
} from './shop-inventory.js';

export const DAILY_CLAIM_COINS = 10;

export const getFrameById = (frameId) => {
  const frame = getFrameByIdForPurchase(frameId);
  if (!frame) return null;
  return {
    id: frame.id,
    name: frame.name,
    price: frame.price,
    rarity: frame.rarity,
    durationDays: frame.durationDays || 0,
    priceTiers: Array.isArray(frame.priceTiers) ? frame.priceTiers : [],
  };
};

/** @deprecated 返回活跃 id 列表；完整库存请用 parseOwnershipList */
export const parseOwnedFrames = (raw) => {
  const valid = getValidFrameIds();
  const active = filterActiveOwnership(parseOwnershipList(raw));
  return ownershipIds(active).filter((id) => valid.has(id));
};

export const ensureDefaultOwned = (ownedRecords) => {
  // ownedRecords: ownership objects or ids
  let list = Array.isArray(ownedRecords)
    ? ownedRecords.map((item) => (
      typeof item === 'string' ? { id: item, expiresAt: null } : item
    ))
    : [];
  list = filterActiveOwnership(list);
  const catalog = listShopCatalog();
  const have = new Set(ownershipIds(list));
  catalog.forEach((item) => {
    if (item.grantOnRegister && !have.has(item.id)) {
      list.push({ id: item.id, expiresAt: null });
    }
  });
  return list;
};

export const getShopCatalogItems = () => listShopCatalog();

export const getValidShopFrameIds = () => getValidFrameIds();
export const getOnSaleShopFrameIds = () => getOnSaleFrameIds();
