import React from 'react';
import { Badge, SketchButton } from '@/components/SketchUI';

export type AdminVocabularyItem = {
  id: number;
  word: string;
  enabled: boolean;
  updatedAt: number;
};

type AdminVocabularyViewProps = {
  items: AdminVocabularyItem[];
  search: string;
  newWord: string;
  total: number;
  page: number;
  totalPages: number;
  loading: boolean;
  submitting: boolean;
  canManage: boolean;
  formatUpdatedAt: (value: number) => string;
  onSearchChange: (value: string) => void;
  onNewWordChange: (value: string) => void;
  onAdd: (event: React.FormEvent) => void;
  onImport: () => void;
  onExport: () => void;
  onToggle: (id: number, enabled: boolean) => void;
  onDelete: (id: number) => void;
  onPageChange: (page: number) => void;
};

const AdminVocabularyView: React.FC<AdminVocabularyViewProps> = ({
  items,
  search,
  newWord,
  total,
  page,
  totalPages,
  loading,
  submitting,
  canManage,
  formatUpdatedAt,
  onSearchChange,
  onNewWordChange,
  onAdd,
  onImport,
  onExport,
  onToggle,
  onDelete,
  onPageChange,
}) => (
  <div className="bg-white p-6 border-2 border-ink rounded-lg shadow-sketch-sm">
    <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
      <div>
        <h3 className="font-display text-xl">违禁词库</h3>
        <p className="text-xs text-pencil font-sans">保存后立即生效，无需重启服务</p>
      </div>
      <div className="flex items-center gap-2">
        {canManage && (
          <SketchButton
            type="button"
            variant="secondary"
            className="h-9 px-4 text-sm"
            onClick={onImport}
            disabled={submitting || loading}
          >
            从TXT导入
          </SketchButton>
        )}
        <SketchButton
          type="button"
          variant="secondary"
          className="h-9 px-4 text-sm"
          onClick={onExport}
          disabled={submitting || loading}
        >
          导出到剪贴板
        </SketchButton>
      </div>
    </div>

    <div className="flex flex-wrap items-center gap-3 mb-4">
      <input
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder="搜索违禁词..."
        className="flex-1 min-w-[180px] bg-transparent border-2 border-gray-200 rounded-lg outline-none font-sans text-sm text-ink placeholder:text-pencil/40 px-3 py-2 focus:border-ink transition-colors"
        disabled={loading || submitting}
      />
      {canManage && <form onSubmit={onAdd} className="flex items-center gap-2">
        <input
          value={newWord}
          onChange={(e) => onNewWordChange(e.target.value)}
          placeholder="新增违禁词"
          className="min-w-[160px] bg-transparent border-2 border-gray-200 rounded-lg outline-none font-sans text-sm text-ink placeholder:text-pencil/40 px-3 py-2 focus:border-ink transition-colors"
          disabled={loading || submitting}
        />
        <SketchButton
          type="submit"
          className="h-9 px-4 text-sm"
          disabled={submitting || loading}
        >
          添加
        </SketchButton>
      </form>}
    </div>

    <div className="flex items-center justify-between text-xs text-pencil font-sans mb-3">
      <span>共 {total} 条</span>
      <span>第 {page} / {totalPages} 页</span>
    </div>

    {loading ? (
      <div className="text-center py-10 bg-gray-50 border-2 border-dashed border-gray-200 rounded-lg text-pencil font-hand">
        正在加载违禁词...
      </div>
    ) : items.length === 0 ? (
      <div className="text-center py-10 bg-gray-50 border-2 border-dashed border-gray-200 rounded-lg text-pencil font-hand">
        暂无匹配的违禁词
      </div>
    ) : (
      <div className="flex flex-col gap-3">
        {items.map((item) => (
          <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 border-2 border-ink/10 rounded-lg px-4 py-3">
            <div className="flex items-center gap-3">
              <span className="font-sans text-ink text-sm font-semibold">{item.word}</span>
              <Badge color={item.enabled ? 'bg-highlight' : 'bg-gray-200'}>
                {item.enabled ? '启用' : '停用'}
              </Badge>
              <span className="text-xs text-pencil font-sans">更新：{formatUpdatedAt(item.updatedAt)}</span>
            </div>
            {canManage && <div className="flex items-center gap-2">
              <SketchButton
                type="button"
                variant="secondary"
                className="h-8 px-3 text-xs"
                onClick={() => onToggle(item.id, !item.enabled)}
                disabled={submitting}
              >
                {item.enabled ? '停用' : '启用'}
              </SketchButton>
              <SketchButton
                type="button"
                variant="danger"
                className="h-8 px-3 text-xs"
                onClick={() => onDelete(item.id)}
                disabled={submitting}
              >
                删除
              </SketchButton>
            </div>}
          </div>
        ))}
      </div>
    )}

    <div className="flex items-center justify-between mt-4 text-xs text-pencil font-sans">
      <SketchButton
        type="button"
        variant="secondary"
        className="h-8 px-3 text-xs"
        disabled={page <= 1 || loading}
        onClick={() => onPageChange(Math.max(page - 1, 1))}
      >
        上一页
      </SketchButton>
      <SketchButton
        type="button"
        variant="secondary"
        className="h-8 px-3 text-xs"
        disabled={page >= totalPages || loading}
        onClick={() => onPageChange(Math.min(page + 1, totalPages))}
      >
        下一页
      </SketchButton>
    </div>
  </div>
);

export default AdminVocabularyView;
