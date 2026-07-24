import type { RecruitmentXinfaOption } from '@/types';

/**
 * 招募目录的本地基准：23 个展示选项，对应 24 条原始 DPS 心法记录。
 * 藏剑通过 sourceIds 保留问水诀与山居剑意两个底层记录。
 */
export const RAW_DPS_XINFA: RecruitmentXinfaOption[] = [
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
  { id: 'cangjian', name: '藏剑（问水诀 / 山居剑意）', school: '藏剑', damageType: '外', sourceIds: ['10144', '10145'] },
  { id: '10224', name: '惊羽诀', school: '唐门', damageType: '外', sourceIds: ['10224'] },
  { id: '10268', name: '笑尘诀', school: '丐帮', damageType: '外', sourceIds: ['10268'] },
  { id: '10390', name: '分山劲', school: '苍云', damageType: '外', sourceIds: ['10390'] },
  { id: '10464', name: '北傲诀', school: '霸刀', damageType: '外', sourceIds: ['10464'] },
  { id: '10533', name: '凌海诀', school: '蓬莱', damageType: '外', sourceIds: ['10533'] },
  { id: '10585', name: '隐龙诀', school: '凌雪', damageType: '外', sourceIds: ['10585'] },
  { id: '10698', name: '孤锋诀', school: '刀宗', damageType: '外', sourceIds: ['10698'] },
  { id: '10756', name: '山海心诀', school: '万灵', damageType: '外', sourceIds: ['10756'] },
];

/** 服务端 catalog 的展示归一化，确保藏剑只显示一个选项。 */
export const normalizeXinfaOptions = (items: RecruitmentXinfaOption[]): RecruitmentXinfaOption[] => {
  const options: RecruitmentXinfaOption[] = [];
  let cangjian: RecruitmentXinfaOption | null = null;
  let cangjianIndex = -1;

  for (const item of items) {
    if (!item || !item.id) continue;
    const school = String(item.school || '');
    const id = String(item.id);
    const isCangjian = id === 'cangjian'
      || school === '藏剑'
      || /问水诀|山居剑意/.test(String(item.name || ''));
    if (isCangjian) {
      if (cangjianIndex < 0) cangjianIndex = options.length;
      cangjian = {
        id: 'cangjian',
        name: '藏剑（问水诀 / 山居剑意）',
        school: '藏剑',
        sourceIds: Array.from(new Set([...(cangjian?.sourceIds || []), ...(item.sourceIds || [])])),
        damageType: item.damageType || '外',
      };
      continue;
    }
    options.push({
      id,
      name: String(item.name || item.id),
      school: item.school || '',
      damageType: item.damageType,
      sourceIds: item.sourceIds,
    });
  }

  if (cangjian) options.splice(Math.max(0, cangjianIndex), 0, cangjian);
  return options;
};

export const FALLBACK_XINFA_OPTIONS: RecruitmentXinfaOption[] = normalizeXinfaOptions(
  RAW_DPS_XINFA,
);

export const findXinfaName = (
  id: string | null | undefined,
  options: RecruitmentXinfaOption[] = FALLBACK_XINFA_OPTIONS,
) => options.find((item) => item.id === id)?.name || id || '未选择';
