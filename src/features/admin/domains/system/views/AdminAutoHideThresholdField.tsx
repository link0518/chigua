import React from 'react';
import { AUTO_HIDE_REPORT_THRESHOLD_MAX } from '../rateLimitSettings';

type AdminAutoHideThresholdFieldProps = {
  value: number;
  disabled: boolean;
  onChange: (value: string) => void;
};

const AdminAutoHideThresholdField: React.FC<AdminAutoHideThresholdFieldProps> = ({
  value,
  disabled,
  onChange,
}) => (
  <div className="space-y-3 rounded-lg border border-gray-200 bg-paper/60 p-3">
    <div className="space-y-1">
      <label className="text-sm font-sans font-bold text-ink block">举报自动隐藏阈值</label>
      <p className="text-xs text-pencil font-sans">
        同一帖子或评论在最近 24 小时内达到该数量的待处理举报后，会自动暂时隐藏。
      </p>
    </div>
    <div className="max-w-xs">
      <input
        type="number"
        min={1}
        max={AUTO_HIDE_REPORT_THRESHOLD_MAX}
        step={1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-white border-2 border-gray-200 rounded-lg outline-none font-sans text-sm text-ink px-3 py-2 focus:border-ink transition-colors"
        disabled={disabled}
      />
    </div>
    <p className="text-xs text-pencil font-sans">
      当前规则：24 小时内达到 {value} 条待处理举报后自动隐藏。
    </p>
  </div>
);

export default AdminAutoHideThresholdField;
