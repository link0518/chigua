import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle, Pencil, RotateCcw, Search, Trash2, XCircle } from 'lucide-react';

import { api } from '../api';
import type { Toast } from '../store/AppContext';
import type { WikiEntry, WikiRevision } from '../types';
import MarkdownRenderer from './MarkdownRenderer';
import { Badge, SketchButton } from './SketchUI';
import WikiMarkdownComposer from './WikiMarkdownComposer';
import { getWikiMarkdownExcerpt } from './wiki/wikiMarkdownPlainText';

type RevisionStatus = 'pending' | 'approved' | 'rejected';
type RevisionActionType = 'all' | 'create' | 'edit';
type EntryStatus = 'active' | 'deleted' | 'all';

interface AdminWikiPanelProps {
  showToast: (message: string, type?: Toast['type']) => void;
  onPendingCountChange?: () => void;
}

const WIKI_PAGE_SIZE = 12;
const WIKI_NARRATIVE_MAX_LENGTH = 8000;

const formatTime = (value?: number | null) => {
  if (!value) {
    return '-';
  }
  return new Date(value).toLocaleString('zh-CN');
};

const parseTagsInput = (value: string) => String(value || '')
  .split(/[\r\n,，、;；|]+/g)
  .map((item) => item.trim().replace(/^#+/, '').replace(/\s+/g, ' '))
  .filter(Boolean)
  .slice(0, 6);

const formatTagsInput = (tags: string[]) => (Array.isArray(tags) ? tags : []).join('\n');

const WikiEntryEditor: React.FC<{
  open: boolean;
  entry?: WikiEntry | null;
  onClose: () => void;
  onSaved: () => void;
  showToast: AdminWikiPanelProps['showToast'];
}> = ({ open, entry, onClose, onSaved, showToast }) => {
  const [name, setName] = useState('');
  const [narrative, setNarrative] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }
    setName(entry?.name || '');
    setNarrative(entry?.narrative || '');
    setTagsInput(formatTagsInput(entry?.tags || []));
    setSubmitting(false);
  }, [entry, open]);

  if (!open) {
    return null;
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const payload = {
      name: name.trim(),
      narrative: narrative.trim(),
      tags: parseTagsInput(tagsInput),
      editSummary: entry ? '管理员直接编辑' : '管理员创建',
    };
    if (!payload.name || !payload.narrative) {
      showToast('请填写名字和记录叙述', 'warning');
      return;
    }
    if (payload.narrative.length > WIKI_NARRATIVE_MAX_LENGTH) {
      showToast(`记录叙述不能超过 ${WIKI_NARRATIVE_MAX_LENGTH} 个字符`, 'warning');
      return;
    }
    setSubmitting(true);
    try {
      if (entry) {
        await api.updateAdminWikiEntry(entry.id, payload);
      } else {
        await api.createAdminWikiEntry(payload);
      }
      showToast(entry ? '瓜条已更新' : '瓜条已创建', 'success');
      onSaved();
      onClose();
    } catch (error) {
      showToast(error instanceof Error ? error.message : '保存失败', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-black/40" aria-label="关闭编辑窗口" onClick={onClose} />
      <form onSubmit={handleSubmit} className="relative z-10 w-full max-w-2xl rounded-lg border-2 border-ink bg-white p-6 shadow-sketch-lg">
        <h3 className="mb-4 font-display text-2xl text-ink">{entry ? '编辑瓜条' : '新建瓜条'}</h3>
        <div className="grid gap-4">
          <label className="space-y-1">
            <span className="text-sm font-bold text-ink">名字</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="w-full rounded-lg border-2 border-gray-200 px-3 py-2 font-sans text-sm outline-none focus:border-ink"
            />
          </label>
          <label className="space-y-1">
            <span className="text-sm font-bold text-ink">标签（一行或逗号分隔）</span>
            <textarea
              value={tagsInput}
              onChange={(event) => setTagsInput(event.target.value)}
              rows={3}
              className="w-full resize-none rounded-lg border-2 border-gray-200 px-3 py-2 font-sans text-sm outline-none focus:border-ink"
            />
          </label>
          <div className="space-y-1">
            <span className="text-sm font-bold text-ink">记录叙述</span>
            <WikiMarkdownComposer
              value={narrative}
              onChange={setNarrative}
              placeholder="请输入记录叙述，支持 Markdown。"
              maxLength={WIKI_NARRATIVE_MAX_LENGTH}
              minHeight="240px"
              ariaLabel={entry ? '后台编辑瓜条 Markdown 编辑器' : '后台新建瓜条 Markdown 编辑器'}
              toolbarLabel="记录叙述"
              emptyPreviewText="预览区为空，请先填写记录叙述。"
              renderClassName="font-sans text-sm leading-relaxed text-ink [&_p]:mb-4 [&_blockquote]:my-4 [&_ol]:my-4 [&_ul]:my-4 [&_pre]:my-4"
              theme="admin"
            />
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <SketchButton type="button" variant="secondary" onClick={onClose} disabled={submitting}>
            取消
          </SketchButton>
          <SketchButton type="submit" disabled={submitting}>
            {submitting ? '保存中...' : '保存'}
          </SketchButton>
        </div>
      </form>
    </div>
  );
};

const AdminWikiPanel: React.FC<AdminWikiPanelProps> = ({ showToast, onPendingCountChange }) => {
  const [tab, setTab] = useState<'revisions' | 'entries'>('revisions');
  const [revisionStatus, setRevisionStatus] = useState<RevisionStatus>('pending');
  const [revisionActionType, setRevisionActionType] = useState<RevisionActionType>('all');
  const [revisionSearch, setRevisionSearch] = useState('');
  const [revisionPage, setRevisionPage] = useState(1);
  const [revisions, setRevisions] = useState<WikiRevision[]>([]);
  const [revisionTotal, setRevisionTotal] = useState(0);
  const [revisionLoading, setRevisionLoading] = useState(false);
  const [entryStatus, setEntryStatus] = useState<EntryStatus>('active');
  const [entrySearch, setEntrySearch] = useState('');
  const [entryPage, setEntryPage] = useState(1);
  const [entries, setEntries] = useState<WikiEntry[]>([]);
  const [entryTotal, setEntryTotal] = useState(0);
  const [entryLoading, setEntryLoading] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<WikiEntry | null>(null);

  const revisionPages = Math.max(Math.ceil(revisionTotal / WIKI_PAGE_SIZE), 1);
  const entryPages = Math.max(Math.ceil(entryTotal / WIKI_PAGE_SIZE), 1);

  const loadRevisions = useCallback(async () => {
    setRevisionLoading(true);
    try {
      const data = await api.getAdminWikiRevisions({
        status: revisionStatus,
        actionType: revisionActionType,
        q: revisionSearch,
        page: revisionPage,
        limit: WIKI_PAGE_SIZE,
      });
      setRevisions(Array.isArray(data?.items) ? data.items : []);
      setRevisionTotal(Number(data?.total || 0));
    } catch (error) {
      showToast(error instanceof Error ? error.message : '瓜条审核记录加载失败', 'error');
      setRevisions([]);
      setRevisionTotal(0);
    } finally {
      setRevisionLoading(false);
    }
  }, [revisionActionType, revisionPage, revisionSearch, revisionStatus, showToast]);

  const loadEntries = useCallback(async () => {
    setEntryLoading(true);
    try {
      const data = await api.getAdminWikiEntries({
        status: entryStatus,
        q: entrySearch,
        page: entryPage,
        limit: WIKI_PAGE_SIZE,
      });
      setEntries(Array.isArray(data?.items) ? data.items : []);
      setEntryTotal(Number(data?.total || 0));
    } catch (error) {
      showToast(error instanceof Error ? error.message : '瓜条加载失败', 'error');
      setEntries([]);
      setEntryTotal(0);
    } finally {
      setEntryLoading(false);
    }
  }, [entryPage, entrySearch, entryStatus, showToast]);

  useEffect(() => {
    if (tab === 'revisions') {
      loadRevisions();
    }
  }, [loadRevisions, tab]);

  useEffect(() => {
    if (tab === 'entries') {
      loadEntries();
    }
  }, [loadEntries, tab]);

  const pendingCount = useMemo(() => (
    revisionStatus === 'pending' ? revisionTotal : revisions.filter((item) => item.status === 'pending').length
  ), [revisionStatus, revisionTotal, revisions]);

  const handleRevisionAction = async (revision: WikiRevision, action: 'approve' | 'reject') => {
    const reason = action === 'reject'
      ? window.prompt('请输入拒绝原因（可留空）') || ''
      : '';
    try {
      await api.handleAdminWikiRevision(revision.id, action, reason);
      showToast(action === 'approve' ? '瓜条审核已通过' : '瓜条审核已拒绝', 'success');
      await loadRevisions();
      onPendingCountChange?.();
      if (tab === 'entries') {
        await loadEntries();
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : '操作失败', 'error');
    }
  };

  const handleEntryAction = async (entry: WikiEntry, action: 'delete' | 'restore') => {
    const confirmed = window.confirm(action === 'delete' ? '确认删除该瓜条？' : '确认恢复该瓜条？');
    if (!confirmed) {
      return;
    }
    try {
      await api.handleAdminWikiEntry(entry.id, action, action === 'delete' ? '管理员删除' : '管理员恢复');
      showToast(action === 'delete' ? '瓜条已删除' : '瓜条已恢复', 'success');
      await loadEntries();
    } catch (error) {
      showToast(error instanceof Error ? error.message : '操作失败', 'error');
    }
  };

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-4 rounded-lg border-2 border-ink bg-white p-5 shadow-sketch-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-2xl text-ink">瓜条审核</h3>
            <p className="font-sans text-sm text-pencil">审核新瓜条投稿和瓜条编辑，公开页只展示已通过版本。</p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setTab('revisions')}
              className={`rounded-full border-2 px-4 py-2 text-sm font-bold ${tab === 'revisions' ? 'border-ink bg-highlight' : 'border-gray-200 bg-white'}`}
            >
              审核记录
            </button>
            <button
              type="button"
              onClick={() => setTab('entries')}
              className={`rounded-full border-2 px-4 py-2 text-sm font-bold ${tab === 'entries' ? 'border-ink bg-highlight' : 'border-gray-200 bg-white'}`}
            >
              瓜条管理
            </button>
          </div>
        </div>
        {pendingCount > 0 && (
          <div className="rounded-lg bg-highlight/50 px-4 py-2 text-sm font-bold text-ink">
            当前有 {pendingCount} 条瓜条内容等待审核。
          </div>
        )}
      </div>

      {tab === 'revisions' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            {(['pending', 'approved', 'rejected'] as RevisionStatus[]).map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => {
                  setRevisionStatus(status);
                  setRevisionPage(1);
                }}
                className={`rounded-full border-2 px-3 py-1 text-xs font-bold ${revisionStatus === status ? 'border-ink bg-highlight' : 'border-transparent bg-white hover:border-ink'}`}
              >
                {status === 'pending' ? '待审核' : status === 'approved' ? '已通过' : '已拒绝'}
              </button>
            ))}
            {(['all', 'create', 'edit'] as RevisionActionType[]).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => {
                  setRevisionActionType(type);
                  setRevisionPage(1);
                }}
                className={`rounded-full border-2 px-3 py-1 text-xs font-bold ${revisionActionType === type ? 'border-ink bg-marker-blue' : 'border-transparent bg-white hover:border-ink'}`}
              >
                {type === 'all' ? '全部类型' : type === 'create' ? '新瓜条' : '编辑'}
              </button>
            ))}
            <div className="relative min-w-[220px] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-pencil" />
              <input
                value={revisionSearch}
                onChange={(event) => {
                  setRevisionSearch(event.target.value);
                  setRevisionPage(1);
                }}
                placeholder="搜索名字、内容、ID..."
                className="w-full rounded-full border-2 border-ink bg-white py-2 pl-9 pr-4 text-sm outline-none"
              />
            </div>
          </div>

          {revisionLoading ? (
            <div className="rounded-lg border-2 border-dashed border-gray-200 bg-white p-10 text-center text-pencil">正在加载瓜条审核记录...</div>
          ) : revisions.length === 0 ? (
            <div className="rounded-lg border-2 border-dashed border-gray-200 bg-white p-10 text-center text-pencil">暂无匹配记录</div>
          ) : (
            <div className="flex flex-col gap-4">
              {revisions.map((revision) => (
                <article key={revision.id} className="rounded-lg border-2 border-ink bg-white p-5 shadow-sketch-sm">
                  <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0 flex-1 space-y-3">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <Badge color={revision.actionType === 'create' ? 'bg-marker-green' : 'bg-marker-blue'}>
                          {revision.actionType === 'create' ? '新瓜条' : '编辑'}
                        </Badge>
                        <Badge color={revision.status === 'pending' ? 'bg-highlight' : revision.status === 'approved' ? 'bg-marker-green' : 'bg-alert'}>
                          {revision.status === 'pending' ? '待审核' : revision.status === 'approved' ? '已通过' : '已拒绝'}
                        </Badge>
                        <span className="text-pencil">提交：{formatTime(revision.createdAt)}</span>
                        {revision.reviewedAt && <span className="text-pencil">审核：{formatTime(revision.reviewedAt)}</span>}
                      </div>
                      <div>
                        <h4 className="font-sans text-lg font-bold text-ink">{revision.data.name}</h4>
                        <div className="mt-1 flex flex-wrap gap-2">
                          {revision.data.tags.map((tag) => (
                            <span key={tag} className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-pencil">#{tag}</span>
                          ))}
                        </div>
                      </div>
                      {revision.editSummary && (
                        <div className="rounded-lg border border-[#546354]/15 bg-[#f7faf7] px-4 py-3">
                          <div className="text-[10px] font-bold tracking-widest text-[#546354]">
                            {revision.actionType === 'edit' ? '编辑原因' : '提交说明'}
                          </div>
                          <p className="mt-1 whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-ink">
                            {revision.editSummary}
                          </p>
                        </div>
                      )}
                      <MarkdownRenderer
                        content={revision.data.narrative}
                        className="font-sans text-sm leading-relaxed text-ink [&_p]:mb-4 [&_blockquote]:my-4 [&_ol]:my-4 [&_ul]:my-4 [&_pre]:my-4"
                      />
                      <div className="flex flex-wrap gap-3 text-xs text-pencil">
                        <span>ID：{revision.id}</span>
                        {revision.entrySlug && <span>瓜条：{revision.entrySlug}</span>}
                        {revision.submitterIp && <span>IP：{revision.submitterIp}</span>}
                      </div>
                      {revision.reviewReason && <p className="text-xs text-red-600">拒绝原因：{revision.reviewReason}</p>}
                    </div>
                    {revision.status === 'pending' && (
                      <div className="flex shrink-0 flex-wrap gap-2">
                        <SketchButton
                          type="button"
                          variant="secondary"
                          className="h-10 px-3 text-xs"
                          onClick={() => handleRevisionAction(revision, 'approve')}
                        >
                          <CheckCircle className="mr-1 inline h-4 w-4" /> 通过
                        </SketchButton>
                        <SketchButton
                          type="button"
                          variant="danger"
                          className="h-10 px-3 text-xs"
                          onClick={() => handleRevisionAction(revision, 'reject')}
                        >
                          <XCircle className="mr-1 inline h-4 w-4" /> 拒绝
                        </SketchButton>
                      </div>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}

          <div className="flex items-center justify-center gap-4 text-xs text-pencil">
            <SketchButton type="button" variant="secondary" className="px-4 py-2 text-sm" disabled={revisionPage <= 1} onClick={() => setRevisionPage((prev) => Math.max(prev - 1, 1))}>
              上一页
            </SketchButton>
            <span>第 {revisionPage} / {revisionPages} 页</span>
            <SketchButton type="button" variant="secondary" className="px-4 py-2 text-sm" disabled={revisionPage >= revisionPages} onClick={() => setRevisionPage((prev) => Math.min(prev + 1, revisionPages))}>
              下一页
            </SketchButton>
          </div>
        </div>
      )}

      {tab === 'entries' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            {(['active', 'deleted', 'all'] as EntryStatus[]).map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => {
                  setEntryStatus(status);
                  setEntryPage(1);
                }}
                className={`rounded-full border-2 px-3 py-1 text-xs font-bold ${entryStatus === status ? 'border-ink bg-highlight' : 'border-transparent bg-white hover:border-ink'}`}
              >
                {status === 'active' ? '公开中' : status === 'deleted' ? '已删除' : '全部'}
              </button>
            ))}
            <div className="relative min-w-[220px] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-pencil" />
              <input
                value={entrySearch}
                onChange={(event) => {
                  setEntrySearch(event.target.value);
                  setEntryPage(1);
                }}
                placeholder="搜索瓜条..."
                className="w-full rounded-full border-2 border-ink bg-white py-2 pl-9 pr-4 text-sm outline-none"
              />
            </div>
            <SketchButton
              type="button"
              className="h-10 px-4 text-sm"
              onClick={() => {
                setEditingEntry(null);
                setEditorOpen(true);
              }}
            >
              新建公开瓜条
            </SketchButton>
          </div>

          {entryLoading ? (
            <div className="rounded-lg border-2 border-dashed border-gray-200 bg-white p-10 text-center text-pencil">正在加载瓜条...</div>
          ) : entries.length === 0 ? (
            <div className="rounded-lg border-2 border-dashed border-gray-200 bg-white p-10 text-center text-pencil">暂无匹配瓜条</div>
          ) : (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              {entries.map((entry) => (
                <article key={entry.id} className="rounded-lg border-2 border-ink bg-white p-5 shadow-sketch-sm">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="font-sans text-lg font-bold text-ink">{entry.name}</h4>
                        <Badge color={entry.deleted ? 'bg-alert' : 'bg-marker-green'}>{entry.deleted ? '已删除' : '公开'}</Badge>
                        <Badge color="bg-gray-100">v{entry.versionNumber}</Badge>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {entry.tags.map((tag) => (
                          <span key={tag} className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-pencil">#{tag}</span>
                        ))}
                      </div>
                      <p className="line-clamp-4 break-words font-sans text-sm leading-relaxed text-pencil">
                        {getWikiMarkdownExcerpt(entry.narrative, 140)}
                      </p>
                      <p className="text-xs text-pencil">更新：{formatTime(entry.updatedAt)} · slug：{entry.slug}</p>
                    </div>
                    <div className="flex shrink-0 flex-col gap-2">
                      <SketchButton
                        type="button"
                        variant="secondary"
                        className="h-9 px-3 text-xs"
                        onClick={() => {
                          setEditingEntry(entry);
                          setEditorOpen(true);
                        }}
                      >
                        <Pencil className="mr-1 inline h-4 w-4" /> 编辑
                      </SketchButton>
                      {entry.deleted ? (
                        <SketchButton type="button" variant="secondary" className="h-9 px-3 text-xs" onClick={() => handleEntryAction(entry, 'restore')}>
                          <RotateCcw className="mr-1 inline h-4 w-4" /> 恢复
                        </SketchButton>
                      ) : (
                        <SketchButton type="button" variant="danger" className="h-9 px-3 text-xs" onClick={() => handleEntryAction(entry, 'delete')}>
                          <Trash2 className="mr-1 inline h-4 w-4" /> 删除
                        </SketchButton>
                      )}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}

          <div className="flex items-center justify-center gap-4 text-xs text-pencil">
            <SketchButton type="button" variant="secondary" className="px-4 py-2 text-sm" disabled={entryPage <= 1} onClick={() => setEntryPage((prev) => Math.max(prev - 1, 1))}>
              上一页
            </SketchButton>
            <span>第 {entryPage} / {entryPages} 页</span>
            <SketchButton type="button" variant="secondary" className="px-4 py-2 text-sm" disabled={entryPage >= entryPages} onClick={() => setEntryPage((prev) => Math.min(prev + 1, entryPages))}>
              下一页
            </SketchButton>
          </div>
        </div>
      )}

      <WikiEntryEditor
        open={editorOpen}
        entry={editingEntry}
        onClose={() => setEditorOpen(false)}
        onSaved={() => {
          loadEntries();
          loadRevisions();
        }}
        showToast={showToast}
      />
    </section>
  );
};

export default AdminWikiPanel;
