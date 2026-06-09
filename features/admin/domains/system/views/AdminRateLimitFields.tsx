import React from 'react';
import {
  RATE_LIMIT_FIELDS,
  RATE_LIMIT_MAX_COUNT,
  RATE_LIMIT_MAX_WINDOW_SECONDS,
  formatRateLimitWindow,
  type RateLimitAction,
  type RateLimitSettings,
} from '../rateLimitSettings';

type AdminRateLimitFieldsProps = {
  rateLimits: RateLimitSettings;
  disabled: boolean;
  onCountChange: (key: RateLimitAction, value: string) => void;
  onWindowSecondsChange: (key: RateLimitAction, value: string) => void;
};

const AdminRateLimitFields: React.FC<AdminRateLimitFieldsProps> = ({
  rateLimits,
  disabled,
  onCountChange,
  onWindowSecondsChange,
}) => (
  <div className="space-y-3">
    <label className="text-sm font-sans font-bold text-ink block">限流配置</label>
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {RATE_LIMIT_FIELDS.map((item) => {
        const config = rateLimits[item.key];
        const windowSeconds = Math.max(1, Math.round(config.windowMs / 1000));
        return (
          <div
            key={item.key}
            className="rounded-lg border border-gray-200 bg-paper/60 p-3 space-y-3"
          >
            <div className="space-y-1">
              <p className="text-sm font-sans font-bold text-ink">{item.label}</p>
              <p className="text-xs text-pencil font-sans">{item.hint}</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1">
                <span className="text-xs text-pencil font-sans">次数</span>
                <input
                  type="number"
                  min={1}
                  max={RATE_LIMIT_MAX_COUNT}
                  step={1}
                  value={config.limit}
                  onChange={(e) => onCountChange(item.key, e.target.value)}
                  className="w-full bg-white border-2 border-gray-200 rounded-lg outline-none font-sans text-sm text-ink px-3 py-2 focus:border-ink transition-colors"
                  disabled={disabled}
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs text-pencil font-sans">窗口（秒）</span>
                <input
                  type="number"
                  min={1}
                  max={RATE_LIMIT_MAX_WINDOW_SECONDS}
                  step={1}
                  value={windowSeconds}
                  onChange={(e) => onWindowSecondsChange(item.key, e.target.value)}
                  className="w-full bg-white border-2 border-gray-200 rounded-lg outline-none font-sans text-sm text-ink px-3 py-2 focus:border-ink transition-colors"
                  disabled={disabled}
                />
              </label>
            </div>
            <p className="text-xs text-pencil font-sans">
              当前规则：{formatRateLimitWindow(config.windowMs)} 内最多 {config.limit} 次
            </p>
          </div>
        );
      })}
    </div>
  </div>
);

export default AdminRateLimitFields;
