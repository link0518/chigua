import React from 'react';
import { SketchButton } from '@/components/SketchUI';

type AdminWecomWebhookSettingsProps = {
  enabled: boolean;
  configured: boolean;
  maskedUrl: string;
  urlInput: string;
  clearUrl: boolean;
  testing: boolean;
  disabled: boolean;
  onEnabledChange: (value: boolean) => void;
  onUrlInputChange: (value: string) => void;
  onClearUrlChange: (value: boolean) => void;
  onTest: () => void;
};

const AdminWecomWebhookSettings: React.FC<AdminWecomWebhookSettingsProps> = ({
  enabled,
  configured,
  maskedUrl,
  urlInput,
  clearUrl,
  testing,
  disabled,
  onEnabledChange,
  onUrlInputChange,
  onClearUrlChange,
  onTest,
}) => {
  const testDisabled = disabled
    || testing
    || (!configured && !urlInput.trim())
    || (clearUrl && !urlInput.trim());

  return (
    <div className="space-y-3 border-t border-gray-200 pt-4">
      <div>
        <label className="text-sm font-sans font-bold text-ink block">企业微信机器人提醒</label>
        <p className="text-xs text-pencil font-sans mt-1">
          新留言、自动隐藏待审核内容、瓜条待审和新谣言待审都会推送到企业微信群；推送失败不会影响提交或审核。
        </p>
      </div>
      <label className="flex items-center gap-3 text-sm font-sans">
        <input
          type="checkbox"
          className="w-4 h-4"
          checked={enabled}
          onChange={(e) => onEnabledChange(e.target.checked)}
          disabled={disabled}
        />
        <span>启用企业微信机器人提醒</span>
      </label>
      <div className="rounded-lg border border-gray-200 bg-paper/60 p-3 space-y-3">
        <p className="text-xs text-pencil font-sans">
          当前状态：{configured ? `已配置 ${maskedUrl}` : '未配置'}
        </p>
        <input
          type="url"
          value={urlInput}
          onChange={(e) => onUrlInputChange(e.target.value)}
          placeholder={configured ? '留空则保留当前 Webhook 地址' : 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...'}
          className="w-full bg-white border-2 border-gray-200 rounded-lg outline-none font-sans text-sm text-ink placeholder:text-pencil/40 px-3 py-2 focus:border-ink transition-colors"
          disabled={disabled}
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-xs font-sans text-pencil">
            <input
              type="checkbox"
              className="w-4 h-4"
              checked={clearUrl}
              onChange={(e) => onClearUrlChange(e.target.checked)}
              disabled={disabled || !configured}
            />
            <span>清空已保存的 Webhook 地址</span>
          </label>
          <SketchButton
            type="button"
            variant="secondary"
            className="h-9 px-4 text-xs"
            disabled={testDisabled}
            onClick={onTest}
          >
            {testing ? '发送中...' : '发送测试消息'}
          </SketchButton>
        </div>
      </div>
    </div>
  );
};

export default AdminWecomWebhookSettings;
