const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export const RECRUITMENT_XINFA_RECORDS = Object.freeze([
  { id: '10003', name: '易筋经', school: '少林', damageType: '内', sourceIds: ['10003'] },
  { id: '10014', name: '紫霞功', school: '纯阳', damageType: '内', sourceIds: ['10014'] },
  { id: '10021', name: '花间游', school: '万花', damageType: '内', sourceIds: ['10021'] },
  { id: '10081', name: '冰心诀', school: '七秀', damageType: '内', sourceIds: ['10081'] },
  { id: '10175', name: '毒经', school: '五毒', damageType: '内', sourceIds: ['10175'] },
  { id: '10225', name: '天罗诡道', school: '唐门', damageType: '内', sourceIds: ['10225'] },
  { id: '10242', name: '焚影圣诀', school: '明教', damageType: '内', sourceIds: ['10242'] },
  { id: '10447', name: '莫问', school: '长歌', damageType: '内', sourceIds: ['10447'] },
  { id: '10615', name: '太玄经', school: '衍天', damageType: '内', sourceIds: ['10615'] },
  { id: '10627', name: '无方', school: '药宗', damageType: '内', sourceIds: ['10627'] },
  { id: '10786', name: '周天功', school: '段氏', damageType: '内', sourceIds: ['10786'] },
  { id: '10821', name: '幽罗引', school: '无相', damageType: '内', sourceIds: ['10821'] },
  { id: '10015', name: '太虚剑意', school: '纯阳', damageType: '外', sourceIds: ['10015'] },
  { id: '10026', name: '傲血战意', school: '天策', damageType: '外', sourceIds: ['10026'] },
  { id: 'cangjian', name: '藏剑', school: '藏剑', damageType: '外', sourceIds: ['10144', '10145'] },
  { id: '10224', name: '惊羽诀', school: '唐门', damageType: '外', sourceIds: ['10224'] },
  { id: '10268', name: '笑尘诀', school: '丐帮', damageType: '外', sourceIds: ['10268'] },
  { id: '10390', name: '分山劲', school: '苍云', damageType: '外', sourceIds: ['10390'] },
  { id: '10464', name: '北傲诀', school: '霸刀', damageType: '外', sourceIds: ['10464'] },
  { id: '10533', name: '凌海诀', school: '蓬莱', damageType: '外', sourceIds: ['10533'] },
  { id: '10585', name: '隐龙诀', school: '凌雪', damageType: '外', sourceIds: ['10585'] },
  { id: '10698', name: '孤锋诀', school: '刀宗', damageType: '外', sourceIds: ['10698'] },
  { id: '10756', name: '山海心诀', school: '万灵', damageType: '外', sourceIds: ['10756'] },
]);

export class RecruitmentCatalogError extends Error {
  constructor(message, code = 'invalid_specialization') {
    super(message);
    this.name = 'RecruitmentCatalogError';
    this.code = code;
  }
}

const normalizeRecord = (record, index) => {
  const id = String(record?.id || '').trim();
  const name = String(record?.name || '').trim();
  const school = String(record?.school || '').trim();
  const damageType = String(record?.damageType || record?.damage_type || '').trim();
  const sourceIds = Array.from(new Set(
    (Array.isArray(record?.sourceIds) ? record.sourceIds : [id])
      .map((sourceId) => String(sourceId || '').trim())
      .filter(Boolean)
  ));
  if (!ID_PATTERN.test(id)) {
    throw new RecruitmentCatalogError(`第 ${index + 1} 条 DPS 心法 ID 无效`, 'invalid_catalog');
  }
  if (!name || !school || !['内', '外'].includes(damageType)) {
    throw new RecruitmentCatalogError(`第 ${index + 1} 条 DPS 心法缺少名称、门派或伤害类型`, 'invalid_catalog');
  }
  if (!sourceIds.length || sourceIds.some((sourceId) => !/^\d+$/.test(sourceId))) {
    throw new RecruitmentCatalogError(`第 ${index + 1} 条 DPS 心法源 ID 无效`, 'invalid_catalog');
  }
  return Object.freeze({
    id,
    name,
    school,
    damageType,
    sourceIds: Object.freeze(sourceIds),
  });
};

/**
 * 创建严格的 DPS 目录。藏剑以单一 catalog id 展示，sourceIds 保留两个底层源记录。
 */
export const createRecruitmentCatalog = (records = RECRUITMENT_XINFA_RECORDS) => {
  if (!Array.isArray(records) || records.length === 0) {
    throw new RecruitmentCatalogError('DPS 心法目录不能为空', 'empty_catalog');
  }
  const normalizedRecords = records.map(normalizeRecord);
  const byId = new Map();
  normalizedRecords.forEach((record) => {
    if (byId.has(record.id)) {
      throw new RecruitmentCatalogError(`DPS 心法 ID 重复：${record.id}`, 'duplicate_catalog_id');
    }
    byId.set(record.id, record);
  });

  const getById = (value) => byId.get(String(value || '').trim()) || null;
  const requireId = (value) => {
    const record = getById(value);
    if (!record) {
      throw new RecruitmentCatalogError('请选择有效的 DPS 心法');
    }
    return record.id;
  };

  return Object.freeze({
    size: normalizedRecords.length,
    sourceRecordCount: normalizedRecords.reduce((count, record) => count + record.sourceIds.length, 0),
    list: () => normalizedRecords.slice(),
    getById,
    has: (value) => Boolean(getById(value)),
    requireId,
  });
};

export const recruitmentCatalog = createRecruitmentCatalog();

export const isRecruitmentCatalog = (value) => Boolean(
  value
  && typeof value.list === 'function'
  && typeof value.getById === 'function'
  && typeof value.requireId === 'function'
);

export default createRecruitmentCatalog;
