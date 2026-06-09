import React from 'react';

type AdminCnyThemeStatusProps = {
  autoActive: boolean;
  active: boolean;
  previewActive: boolean;
};

const AdminCnyThemeStatus: React.FC<AdminCnyThemeStatusProps> = ({
  autoActive,
  active,
  previewActive,
}) => (
  <div className="rounded-lg border border-dashed border-ink/40 bg-paper px-3 py-2 text-xs text-pencil font-sans space-y-1">
    <p>自动时段：农历腊月十六 00:00 至 正月十五 23:59（中国时区）</p>
    <p>当前处于春节时段：{autoActive ? '是' : '否'}</p>
    <p>当前前台生效状态：{active ? '是' : '否'}</p>
    <p>本次保存后预计生效：{previewActive ? '是' : '否'}</p>
  </div>
);

export default AdminCnyThemeStatus;
