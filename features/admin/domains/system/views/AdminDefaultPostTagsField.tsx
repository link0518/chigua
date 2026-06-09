import React from 'react';

type AdminDefaultPostTagsFieldProps = {
  value: string;
  validCount: number;
  maxCount: number;
  maxTagLength: number;
  disabled: boolean;
  onChange: (value: string) => void;
};

const AdminDefaultPostTagsField: React.FC<AdminDefaultPostTagsFieldProps> = ({
  value,
  validCount,
  maxCount,
  maxTagLength,
  disabled,
  onChange,
}) => (
  <div className="space-y-2">
    <label className="text-sm font-sans font-bold text-ink block">默认帖子标签</label>
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={`每行一个标签，或用逗号/分号分隔；每个标签最多${maxTagLength}字`}
      rows={4}
      className="w-full bg-transparent border-2 border-gray-200 rounded-lg outline-none font-sans text-sm text-ink placeholder:text-pencil/40 px-3 py-2 focus:border-ink transition-colors resize-y"
      disabled={disabled}
    />
    <div className="text-xs text-pencil font-sans space-y-1">
      <p>投稿页会展示这些默认标签，用户仍可自行创建新标签。</p>
      <p>当前有效：{validCount}/{maxCount}，超长标签与重复标签会自动过滤。</p>
    </div>
  </div>
);

export default AdminDefaultPostTagsField;
