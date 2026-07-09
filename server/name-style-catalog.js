/**
 * 炫彩昵称兼容层：数据来自 name_styles 表（name-style-service）
 */
export {
  listNameStylesForShop,
  getNameStyleById,
  parseOwnedNameStyles,
  getEquippedNameStyleIdIfValid,
  getValidNameStyleIds,
  listNameStylesForRender,
  listNameStyles,
  createNameStyle,
  patchNameStyle,
  NameStyleError,
  initNameStyleService,
} from './name-style-service.js';
