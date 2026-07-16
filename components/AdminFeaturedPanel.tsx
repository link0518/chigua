import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Plus, RotateCcw, Search, XCircle } from 'lucide-react';

import { api } from '../api';
import type {
  AdminFeaturePendingItem,
  AdminFeatureProcessedItem,
  AdminFeaturedPostItem,
  AdminPost,
} from '../types';
import type { Toast } from '../store/AppContext';
import MarkdownRenderer from './MarkdownRenderer';
import Modal from './Modal';
import { Badge, SketchButton } from './SketchUI';
import FeaturedBadge from './FeaturedBadge';

type FeatureTab = 'pending' | 'featured' | 'processed';
type FeatureAction = 'approve' | 'reject' | 'add' | 'remove';
type FeatureItem = AdminFeaturePendingItem | AdminFeaturedPostItem | AdminFeatureProcessedItem;

interface AdminFeaturedPanelProps {
  showToast: (message: string, type?: Toast['type']) => void;
  onPendingCountChange?: () => void;
  canManage?: boolean;
}

const PAGE_SIZE = 10;

const formatTime = (value?: number | null) => (
  value ? new Date(value).toLocaleString('zh-CN') : '-'
);

const AdminFeaturedPanel: React.FC<AdminFeaturedPanelProps> = ({
  showToast,
  onPendingCountChange,
  canManage = true,
}) => {
  const [tab, setTab] = useState<FeatureTab>('pending');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<FeatureItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [actionModal, setActionModal] = useState<{
    item: { postId: string; postContent: string } | null;
    action: FeatureAction;
    reason: string;
  }>({ item: null, action: 'approve', reason: '' });
  const [submitting, setSubmitting] = useState(false);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [addSearch, setAddSearch] = useState('');
  const [addResults, setAddResults] = useState<AdminPost[]>([]);
  const [addLoading, setAddLoading] = useState(false);
  // 快速切换筛选条件时，只允许最后一次请求更新列表。
  const loadRequestIdRef = useRef(0);

  const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1);

  const loadItems = useCallback(async () => {
    const requestId = loadRequestIdRef.current + 1;
    loadRequestIdRef.current = requestId;
    setLoading(true);
    try {
      const data = await api.getAdminPostFeatures({
        mode: tab,
        q: search,
        page,
        limit: PAGE_SIZE,
      });
      if (requestId !== loadRequestIdRef.current) {
        return;
      }
      setItems(Array.isArray(data?.items) ? data.items : []);
      setTotal(Number(data?.total || 0));
    } catch (error) {
      if (requestId !== loadRequestIdRef.current) {
        return;
      }
      showToast(error instanceof Error ? error.message : '精华管理列表加载失败', 'error');
      setItems([]);
      setTotal(0);
    } finally {
      if (requestId === loadRequestIdRef.current) {
        setLoading(false);
      }
    }
  }, [page, search, showToast, tab]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  const openAction = (
    item: { postId: string; postContent: string },
    action: FeatureAction
  ) => {
    if (!canManage) {
      showToast('当前账号只有查看权限，不能处理精华帖子', 'warning');
      return;
    }
    setActionModal({ item, action, reason: '' });
  };

  const closeAction = () => {
    if (!submitting) {
      setActionModal({ item: null, action: 'approve', reason: '' });
    }
  };

  const submitAction = async () => {
    if (!actionModal.item || submitting) {
      return;
    }
    setSubmitting(true);
    try {
      await api.handleAdminPostFeature(
        actionModal.item.postId,
        actionModal.action,
        actionModal.reason.trim()
      );
      const messages: Record<FeatureAction, string> = {
        approve: '已通过申请并将帖子设为精华',
        reject: '已驳回该帖的待审核申请',
        add: '已将帖子直接设为精华',
        remove: '已取消该帖精华',
      };
      showToast(messages[actionModal.action], 'success');
      setActionModal({ item: null, action: 'approve', reason: '' });
      if (actionModal.action === 'add') {
        setAddModalOpen(false);
        setAddResults([]);
        setAddSearch('');
      }
      const shouldMoveToPreviousPage = actionModal.action !== 'add' && items.length === 1 && page > 1;
      if (shouldMoveToPreviousPage) {
        setPage((currentPage) => Math.max(1, currentPage - 1));
      } else {
        await loadItems();
      }
      onPendingCountChange?.();
    } catch (error) {
      showToast(error instanceof Error ? error.message : '操作失败', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const searchPostsForAdd = async () => {
    setAddLoading(true);
    try {
      const data = await api.getAdminPosts({
        status: 'active',
        sort: 'time',
        search: addSearch.trim(),
        page: 1,
        limit: 20,
      });
      setAddResults((Array.isArray(data?.items) ? data.items : []).filter((item: AdminPost) => !item.isFeatured));
    } catch (error) {
      showToast(error instanceof Error ? error.message : '帖子搜索失败', 'error');
      setAddResults([]);
    } finally {
      setAddLoading(false);
    }
  };

  const actionTitle: Record<FeatureAction, string> = {
    approve: '通过精华申请',
    reject: '驳回精华申请',
    add: '新增精华帖子',
    remove: '取消精华帖子',
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-4 rounded-lg border-2 border-ink bg-white p-4 shadow-sketch-sm lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2">
          {([
            ['pending', '待审核'],
            ['featured', '已加精'],
            ['processed', '已处理'],
          ] as Array<[FeatureTab, string]>).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setTab(value);
                setPage(1);
              }}
              className={`rounded-full border-2 border-ink px-4 py-2 text-sm font-bold transition-colors ${tab === value ? 'bg-highlight shadow-sketch-sm' : 'bg-white hover:bg-gray-50'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative min-w-0 sm:w-64">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-pencil" />
            <input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="搜索帖子 ID 或内容"
              className="w-full rounded-full border-2 border-ink bg-white py-2 pl-9 pr-4 text-sm outline-none"
            />
          </div>
          {canManage && (
            <SketchButton
              type="button"
              className="h-10 whitespace-nowrap px-4 text-sm"
              onClick={() => setAddModalOpen(true)}
            >
              <Plus className="mr-1 inline h-4 w-4" />
              新增精华
            </SketchButton>
          )}
        </div>
      </div>

      {loading ? (
        <div className="rounded-lg border-2 border-dashed border-gray-200 bg-white p-10 text-center text-pencil">
          正在加载精华管理列表...
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border-2 border-dashed border-gray-200 bg-white p-10 text-center text-pencil">
          当前筛选条件下暂无内容
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {items.map((rawItem) => {
            const item = rawItem as FeatureItem;
            const key = 'id' in item ? item.id : `${tab}-${item.postId}`;
            return (
              <article key={key} className="rounded-lg border-2 border-ink bg-white p-5 shadow-sketch-sm">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1 space-y-3">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-pencil">
                      {item.isFeatured && <FeaturedBadge label="精华帖子" />}
                      <span>帖子：{item.postId}</span>
                      {'requestCount' in item && <span>申请数：{item.requestCount}</span>}
                      {'latestRequestedAt' in item && <span>最新申请：{formatTime(item.latestRequestedAt)}</span>}
                      {'featuredAt' in item && item.featuredAt && <span>加精时间：{formatTime(item.featuredAt)}</span>}
                      {'reviewedAt' in item && <span>审核时间：{formatTime(item.reviewedAt)}</span>}
                    </div>
                    {'status' in item && (
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <Badge color={item.status === 'approved' ? 'bg-marker-green' : 'bg-gray-100'}>
                          {item.status === 'approved' ? '已通过' : '已驳回'}
                        </Badge>
                        <span className="text-pencil">审核人：{item.reviewedByUsername || '-'}</span>
                        {item.reviewReason && <span className="text-pencil">说明：{item.reviewReason}</span>}
                      </div>
                    )}
                    <div className="max-h-60 overflow-auto rounded-lg border border-dashed border-gray-300 bg-gray-50 p-3 text-sm text-ink">
                      <MarkdownRenderer content={item.postContent || ''} className="font-sans" />
                    </div>
                  </div>

                  {canManage && tab === 'pending' && 'requestCount' in item && (
                    <div className="flex shrink-0 flex-wrap gap-2 lg:w-44 lg:flex-col">
                      <SketchButton type="button" className="h-10 px-3 text-xs" onClick={() => openAction(item, 'approve')}>
                        <CheckCircle2 className="mr-1 inline h-4 w-4" />通过
                      </SketchButton>
                      <SketchButton type="button" variant="secondary" className="h-10 px-3 text-xs" onClick={() => openAction(item, 'reject')}>
                        <XCircle className="mr-1 inline h-4 w-4" />驳回
                      </SketchButton>
                    </div>
                  )}
                  {canManage && tab === 'featured' && !('status' in item) && (
                    <SketchButton type="button" variant="secondary" className="h-10 shrink-0 px-3 text-xs" onClick={() => openAction(item, 'remove')}>
                      <RotateCcw className="mr-1 inline h-4 w-4" />取消精华
                    </SketchButton>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      <div className="flex items-center justify-center gap-4 text-xs text-pencil">
        <SketchButton type="button" variant="secondary" className="px-4 py-2 text-sm" disabled={page <= 1} onClick={() => setPage((value) => Math.max(value - 1, 1))}>
          上一页
        </SketchButton>
        <span>{page} / {totalPages} · 共 {total} 条</span>
        <SketchButton type="button" variant="secondary" className="px-4 py-2 text-sm" disabled={page >= totalPages} onClick={() => setPage((value) => Math.min(value + 1, totalPages))}>
          下一页
        </SketchButton>
      </div>

      <Modal isOpen={addModalOpen} onClose={() => setAddModalOpen(false)} title="新增精华帖子">
        <div className="flex flex-col gap-4">
          <div className="flex gap-2">
            <input
              value={addSearch}
              onChange={(event) => setAddSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  void searchPostsForAdd();
                }
              }}
              placeholder="输入帖子 ID 或正文关键词"
              className="min-w-0 flex-1 rounded-full border-2 border-ink px-4 py-2 text-sm outline-none"
            />
            <SketchButton type="button" className="px-4 text-sm" onClick={searchPostsForAdd} disabled={addLoading}>
              搜索
            </SketchButton>
          </div>
          <div className="max-h-[55vh] space-y-3 overflow-auto pr-1">
            {addLoading ? (
              <p className="py-8 text-center text-pencil">正在搜索...</p>
            ) : addResults.length === 0 ? (
              <p className="py-8 text-center text-pencil">输入条件搜索可加精帖子</p>
            ) : addResults.map((post) => (
              <div key={post.id} className="rounded-lg border-2 border-ink p-3">
                <p className="mb-2 text-xs text-pencil">帖子：{post.id}</p>
                <p className="line-clamp-4 whitespace-pre-wrap break-words text-sm text-ink">{post.content}</p>
                <div className="mt-3 flex justify-end">
                  <SketchButton type="button" className="px-4 text-sm" onClick={() => openAction({ postId: post.id, postContent: post.content }, 'add')}>
                    设为精华
                  </SketchButton>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Modal>

      <Modal isOpen={Boolean(actionModal.item)} onClose={closeAction} title={actionTitle[actionModal.action]}>
        <div className="flex flex-col gap-4">
          <p className="line-clamp-4 whitespace-pre-wrap break-words rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-pencil">
            {actionModal.item?.postContent}
          </p>
          <div>
            <label className="mb-1 block text-xs text-pencil">审核说明（选填）</label>
            <textarea
              value={actionModal.reason}
              onChange={(event) => setActionModal((value) => ({ ...value, reason: event.target.value }))}
              maxLength={1000}
              rows={4}
              className="w-full resize-y rounded-lg border-2 border-ink p-3 text-sm outline-none"
            />
          </div>
          <div className="flex justify-end gap-3">
            <SketchButton type="button" variant="secondary" onClick={closeAction} disabled={submitting}>取消</SketchButton>
            <SketchButton type="button" onClick={submitAction} disabled={submitting}>
              {submitting ? '处理中...' : '确认操作'}
            </SketchButton>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default AdminFeaturedPanel;
