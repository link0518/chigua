import React from 'react';
import { SketchButton } from '@/components/SketchUI';
import {
  type RateLimitAction,
  type RateLimitSettings,
} from '@/features/admin/domains/system/rateLimitSettings';
import AdminAutoHideThresholdField from '@/features/admin/domains/system/views/AdminAutoHideThresholdField';
import AdminCnyThemeStatus from '@/features/admin/domains/system/views/AdminCnyThemeStatus';
import AdminDefaultPostTagsField from '@/features/admin/domains/system/views/AdminDefaultPostTagsField';
import AdminRateLimitFields from '@/features/admin/domains/system/views/AdminRateLimitFields';
import AdminVocabularyView from '@/features/admin/domains/system/views/AdminVocabularyView';
import AdminWecomWebhookSettings from '@/features/admin/domains/system/views/AdminWecomWebhookSettings';

type VocabularyItem = {
  id: number;
  word: string;
  enabled: boolean;
  updatedAt: number;
};

type AdminSystemSettingsViewProps = {
  settingsLoading: boolean;
  settingsSubmitting: boolean;
  turnstileEnabled: boolean;
  cnyThemeEnabled: boolean;
  cnyThemeAutoActive: boolean;
  cnyThemeActive: boolean;
  cnyThemePreviewActive: boolean;
  defaultPostTagsInput: string;
  defaultPostTagsValidCount: number;
  maxDefaultPostTags: number;
  maxTagLength: number;
  autoHideReportThreshold: number;
  wecomWebhookEnabled: boolean;
  wecomWebhookConfigured: boolean;
  wecomWebhookMaskedUrl: string;
  wecomWebhookUrlInput: string;
  wecomWebhookClearUrl: boolean;
  wecomWebhookTesting: boolean;
  rateLimits: RateLimitSettings;
  vocabularyItems: VocabularyItem[];
  vocabularySearch: string;
  vocabularyNewWord: string;
  vocabularyTotal: number;
  vocabularyPage: number;
  totalVocabularyPages: number;
  vocabularyLoading: boolean;
  vocabularySubmitting: boolean;
  canManage: boolean;
  formatUpdatedAt: (value: number | null) => string;
  onSubmit: React.FormEventHandler<HTMLFormElement>;
  onTurnstileEnabledChange: (value: boolean) => void;
  onCnyThemeEnabledChange: (value: boolean) => void;
  onDefaultPostTagsChange: (value: string) => void;
  onAutoHideReportThresholdChange: (value: string) => void;
  onWecomWebhookEnabledChange: (value: boolean) => void;
  onWecomWebhookUrlInputChange: (value: string) => void;
  onWecomWebhookClearUrlChange: (value: boolean) => void;
  onWecomWebhookTest: () => void;
  onRateLimitCountChange: (key: RateLimitAction, value: string) => void;
  onRateLimitWindowSecondsChange: (key: RateLimitAction, value: string) => void;
  onVocabularySearchChange: (value: string) => void;
  onVocabularyNewWordChange: (value: string) => void;
  onVocabularyAdd: React.FormEventHandler<HTMLFormElement>;
  onVocabularyImport: () => void;
  onVocabularyExport: () => void;
  onVocabularyToggle: (id: number, enabled: boolean) => void;
  onVocabularyDelete: (id: number) => void;
  onVocabularyPageChange: (page: number) => void;
};

const AdminSystemSettingsView: React.FC<AdminSystemSettingsViewProps> = ({
  settingsLoading,
  settingsSubmitting,
  turnstileEnabled,
  cnyThemeEnabled,
  cnyThemeAutoActive,
  cnyThemeActive,
  cnyThemePreviewActive,
  defaultPostTagsInput,
  defaultPostTagsValidCount,
  maxDefaultPostTags,
  maxTagLength,
  autoHideReportThreshold,
  wecomWebhookEnabled,
  wecomWebhookConfigured,
  wecomWebhookMaskedUrl,
  wecomWebhookUrlInput,
  wecomWebhookClearUrl,
  wecomWebhookTesting,
  rateLimits,
  vocabularyItems,
  vocabularySearch,
  vocabularyNewWord,
  vocabularyTotal,
  vocabularyPage,
  totalVocabularyPages,
  vocabularyLoading,
  vocabularySubmitting,
  canManage,
  formatUpdatedAt,
  onSubmit,
  onTurnstileEnabledChange,
  onCnyThemeEnabledChange,
  onDefaultPostTagsChange,
  onAutoHideReportThresholdChange,
  onWecomWebhookEnabledChange,
  onWecomWebhookUrlInputChange,
  onWecomWebhookClearUrlChange,
  onWecomWebhookTest,
  onRateLimitCountChange,
  onRateLimitWindowSecondsChange,
  onVocabularySearchChange,
  onVocabularyNewWordChange,
  onVocabularyAdd,
  onVocabularyImport,
  onVocabularyExport,
  onVocabularyToggle,
  onVocabularyDelete,
  onVocabularyPageChange,
}) => {
  const disabled = !canManage || settingsLoading || settingsSubmitting;

  return (
    <section className="space-y-6">
      <form
        onSubmit={(event) => {
          if (!canManage) {
            event.preventDefault();
            return;
          }
          onSubmit(event);
        }}
        className="bg-white p-6 border-2 border-ink rounded-lg shadow-sketch-sm"
      >
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
          <div>
            <h3 className="font-display text-xl">站点开关</h3>
            <p className="text-xs text-pencil font-sans">保存后立即生效，无需重启服务</p>
          </div>
        </div>
        <div className="space-y-4">
          <label className="flex items-center gap-3 text-sm font-sans">
            <input
              type="checkbox"
              className="w-4 h-4"
              checked={turnstileEnabled}
              onChange={(event) => onTurnstileEnabledChange(event.target.checked)}
              disabled={disabled}
            />
            <span>启用 Turnstile 验证</span>
          </label>
          <label className="flex items-center gap-3 text-sm font-sans">
            <input
              type="checkbox"
              className="w-4 h-4"
              checked={cnyThemeEnabled}
              onChange={(event) => onCnyThemeEnabledChange(event.target.checked)}
              disabled={disabled}
            />
            <span>启用春节皮肤（仅前台）</span>
          </label>
          <AdminDefaultPostTagsField
            value={defaultPostTagsInput}
            validCount={defaultPostTagsValidCount}
            maxCount={maxDefaultPostTags}
            maxTagLength={maxTagLength}
            disabled={disabled}
            onChange={onDefaultPostTagsChange}
          />
          <AdminAutoHideThresholdField
            value={autoHideReportThreshold}
            disabled={disabled}
            onChange={onAutoHideReportThresholdChange}
          />
          <AdminWecomWebhookSettings
            enabled={wecomWebhookEnabled}
            configured={wecomWebhookConfigured}
            maskedUrl={wecomWebhookMaskedUrl}
            urlInput={wecomWebhookUrlInput}
            clearUrl={wecomWebhookClearUrl}
            testing={wecomWebhookTesting}
            disabled={disabled}
            onEnabledChange={onWecomWebhookEnabledChange}
            onUrlInputChange={onWecomWebhookUrlInputChange}
            onClearUrlChange={onWecomWebhookClearUrlChange}
            onTest={onWecomWebhookTest}
          />
          <AdminRateLimitFields
            rateLimits={rateLimits}
            disabled={disabled}
            onCountChange={onRateLimitCountChange}
            onWindowSecondsChange={onRateLimitWindowSecondsChange}
          />
          <AdminCnyThemeStatus
            autoActive={cnyThemeAutoActive}
            active={cnyThemeActive}
            previewActive={cnyThemePreviewActive}
          />
        </div>
        <div className="flex justify-end mt-4">
          <SketchButton
            type="submit"
            className="h-10 px-6 text-sm"
            disabled={!canManage || settingsSubmitting || settingsLoading}
          >
            {settingsSubmitting ? '保存中...' : '保存设置'}
          </SketchButton>
        </div>
      </form>

      <AdminVocabularyView
        items={vocabularyItems}
        search={vocabularySearch}
        newWord={vocabularyNewWord}
        total={vocabularyTotal}
        page={vocabularyPage}
        totalPages={totalVocabularyPages}
        loading={vocabularyLoading}
        submitting={vocabularySubmitting}
        canManage={canManage}
        formatUpdatedAt={formatUpdatedAt}
        onSearchChange={onVocabularySearchChange}
        onNewWordChange={onVocabularyNewWordChange}
        onAdd={onVocabularyAdd}
        onImport={onVocabularyImport}
        onExport={onVocabularyExport}
        onToggle={onVocabularyToggle}
        onDelete={onVocabularyDelete}
        onPageChange={onVocabularyPageChange}
      />
    </section>
  );
};

export default AdminSystemSettingsView;
