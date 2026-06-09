import React from 'react';
import { SketchButton } from '@/components/SketchUI';
import MarkdownComposeEditor from '@/components/MarkdownComposeEditor';
import MarkdownRenderer from '@/components/MarkdownRenderer';
import type { UpdateAnnouncementItem } from '@/types';

type ToastType = 'success' | 'error' | 'info' | 'warning';

interface AdminPublishCenterViewProps {
  composeText: string;
  composeMaxLength: number;
  composeSubmitting: boolean;
  composeIncludeDeveloper: boolean;
  announcementText: string;
  announcementUpdatedAt: number | null;
  announcementSubmitting: boolean;
  announcementLoading: boolean;
  updateAnnouncementText: string;
  updateAnnouncementSubmitting: boolean;
  updateAnnouncementLoading: boolean;
  updateAnnouncements: UpdateAnnouncementItem[];
  showToast: (message: string, type?: ToastType) => void;
  formatAnnouncementTime: (value: number | null) => string;
  onComposeTextChange: (value: string) => void;
  onComposeIncludeDeveloperChange: (value: boolean) => void;
  onComposeSubmit: React.FormEventHandler<HTMLFormElement>;
  onAnnouncementTextChange: (value: string) => void;
  onAnnouncementSubmit: React.FormEventHandler<HTMLFormElement>;
  onAnnouncementClear: () => void;
  onUpdateAnnouncementTextChange: (value: string) => void;
  onUpdateAnnouncementSubmit: React.FormEventHandler<HTMLFormElement>;
  onUpdateAnnouncementDelete: (id: string) => void;
}

const AdminPublishCenterView: React.FC<AdminPublishCenterViewProps> = ({
  composeText,
  composeMaxLength,
  composeSubmitting,
  composeIncludeDeveloper,
  announcementText,
  announcementUpdatedAt,
  announcementSubmitting,
  announcementLoading,
  updateAnnouncementText,
  updateAnnouncementSubmitting,
  updateAnnouncementLoading,
  updateAnnouncements,
  showToast,
  formatAnnouncementTime,
  onComposeTextChange,
  onComposeIncludeDeveloperChange,
  onComposeSubmit,
  onAnnouncementTextChange,
  onAnnouncementSubmit,
  onAnnouncementClear,
  onUpdateAnnouncementTextChange,
  onUpdateAnnouncementSubmit,
  onUpdateAnnouncementDelete,
}) => (
  <section className="space-y-6">
    <form
      onSubmit={onComposeSubmit}
      className="bg-white p-6 border-2 border-ink rounded-lg shadow-sketch-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
        <div>
          <h3 className="font-display text-xl">后台投稿</h3>
          <p className="text-xs text-pencil font-sans">与前台投稿保持一致的 Markdown 发布方案</p>
        </div>
      </div>

      <MarkdownComposeEditor
        value={composeText}
        onChange={onComposeTextChange}
        placeholder="在后台发布内容... 支持 Markdown、图片和表情包"
        maxLength={composeMaxLength}
        minHeight="280px"
        ariaLabel="后台投稿 Markdown 编辑器"
        showToast={showToast}
      />

      <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
        <label className="flex items-center gap-2 text-sm font-sans text-pencil select-none">
          <input
            type="checkbox"
            className="w-4 h-4"
            checked={composeIncludeDeveloper}
            onChange={(event) => onComposeIncludeDeveloperChange(event.target.checked)}
          />
          <span>附带开发者信息（显示 admin 名片）</span>
        </label>
        <SketchButton
          type="submit"
          className="h-10 px-6 text-sm"
          disabled={composeSubmitting || !composeText.trim() || composeText.length > composeMaxLength}
        >
          {composeSubmitting ? '发布中...' : '发布'}
        </SketchButton>
      </div>
    </form>

    <form
      onSubmit={onAnnouncementSubmit}
      className="bg-white p-6 border-2 border-ink rounded-lg shadow-sketch-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
        <div>
          <h3 className="font-display text-xl">站点公告</h3>
          <p className="text-xs text-pencil font-sans">仅保留当前一条公告</p>
        </div>
        {announcementUpdatedAt && (
          <span className="text-xs text-pencil font-sans">
            更新时间：{formatAnnouncementTime(announcementUpdatedAt)}
          </span>
        )}
      </div>

      <MarkdownComposeEditor
        value={announcementText}
        onChange={onAnnouncementTextChange}
        placeholder="发布公告内容... 支持 Markdown、图片和表情包"
        maxLength={5000}
        minHeight="240px"
        ariaLabel="站点公告 Markdown 编辑器"
        showToast={showToast}
      />

      <div className="mt-4 flex items-center justify-end gap-2">
        <SketchButton
          type="button"
          variant="secondary"
          className="h-10 px-4 text-sm"
          onClick={onAnnouncementClear}
          disabled={announcementSubmitting || announcementLoading || !announcementText.trim()}
        >
          清空公告
        </SketchButton>
        <SketchButton
          type="submit"
          className="h-10 px-6 text-sm"
          disabled={announcementSubmitting || announcementLoading || !announcementText.trim() || announcementText.length > 5000}
        >
          {announcementSubmitting ? '发布中...' : '发布公告'}
        </SketchButton>
      </div>
    </form>

    <div className="bg-white p-6 border-2 border-ink rounded-lg shadow-sketch-sm space-y-6">
      <form onSubmit={onUpdateAnnouncementSubmit}>
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
          <div>
            <h3 className="font-display text-xl">更新公告</h3>
            <p className="text-xs text-pencil font-sans">保留历史多条，仅记录更新时间与更新内容</p>
          </div>
        </div>

        <MarkdownComposeEditor
          value={updateAnnouncementText}
          onChange={onUpdateAnnouncementTextChange}
          placeholder="发布更新公告内容... 支持 Markdown、图片和表情包"
          maxLength={5000}
          minHeight="240px"
          ariaLabel="更新公告 Markdown 编辑器"
          showToast={showToast}
        />

        <div className="mt-4 flex items-center justify-end">
          <SketchButton
            type="submit"
            className="h-10 px-6 text-sm"
            disabled={updateAnnouncementSubmitting || !updateAnnouncementText.trim() || updateAnnouncementText.length > 5000}
          >
            {updateAnnouncementSubmitting ? '发布中...' : '发布更新公告'}
          </SketchButton>
        </div>
      </form>

      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h4 className="font-display text-lg">历史更新</h4>
          <span className="text-xs text-pencil font-sans">{updateAnnouncements.length} 条</span>
        </div>

        {updateAnnouncementLoading ? (
          <div className="text-center py-10 bg-gray-50 border-2 border-dashed border-gray-200 rounded-lg text-pencil font-hand">
            正在加载更新公告...
          </div>
        ) : updateAnnouncements.length === 0 ? (
          <div className="text-center py-10 bg-gray-50 border-2 border-dashed border-gray-200 rounded-lg text-pencil font-hand">
            暂无更新公告
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {updateAnnouncements.map((item) => (
              <div key={item.id} className="rounded-lg border-2 border-ink/10 bg-gray-50 p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <span className="text-xs text-pencil font-sans">
                    更新时间：{formatAnnouncementTime(item.updatedAt)}
                  </span>
                  <SketchButton
                    type="button"
                    variant="danger"
                    className="h-9 px-3 text-xs"
                    onClick={() => onUpdateAnnouncementDelete(item.id)}
                    disabled={updateAnnouncementSubmitting}
                  >
                    删除
                  </SketchButton>
                </div>
                <MarkdownRenderer content={item.content} className="font-sans text-base text-ink" />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  </section>
);

export default AdminPublishCenterView;
