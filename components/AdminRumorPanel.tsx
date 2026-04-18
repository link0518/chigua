import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  MessageSquare,
  RotateCcw,
  Search,
  XCircle,
} from 'lucide-react';

import { api } from '../api';
import type { Toast } from '../store/AppContext';
import type { RumorReviewItem } from '../types';
import MarkdownRenderer from './MarkdownRenderer';
import Modal from './Modal';
import { Badge, SketchButton } from './SketchUI';

interface AdminRumorPanelProps {
  showToast: (message: string, type?: Toast['type']) => void;
  onPendingCountChange?: () => void;
}

type RumorTab = 'pending' | 'suspected' | 'rejected';
type RumorTargetFilter = 'all' | 'post' | 'comment';
type RejectModalState = {
  isOpen: boolean;
  item: RumorReviewItem | null;
  reason: string;
};

const PAGE_SIZE = 10;

const formatTime = (value?: number | null) => {
  if (!value) {
    return '-';
  }
  return new Date(value).toLocaleString('zh-CN');
};

const AdminRumorPanel: React.FC<AdminRumorPanelProps> = ({ showToast, onPendingCountChange }) => {
  const [tab, setTab] = useState<RumorTab>('pending');
  const [targetType, setTargetType] = useState<RumorTargetFilter>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<RumorReviewItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [actingId, setActingId] = useState('');
  const [rejectModal, setRejectModal] = useState<RejectModalState>({
    isOpen: false,
    item: null,
    reason: '',
  });

  const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1);

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getAdminRumors({
        status: tab,
        targetType,
        q: search,
        page,
        limit: PAGE_SIZE,
      });
      setItems(Array.isArray(data?.items) ? data.items : []);
      setTotal(Number(data?.total || 0));
    } catch (error) {
      showToast(error instanceof Error ? error.message : '谣言审核列表加载失败', 'error');
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [page, search, showToast, tab, targetType]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  const pendingPreviewCount = useMemo(
    () => (tab === 'pending' ? total : items.filter((item) => item.pendingReportCount > 0).length),
    [items, tab, total]
  );

  const closeRejectModal = () => {
    setRejectModal({
      isOpen: false,
      item: null,
      reason: '',
    });
  };

  const submitAction = async (item: RumorReviewItem, action: 'mark' | 'reject' | 'clear', reason = '') => {
    setActingId(item.id);
    try {
      await api.handleAdminRumor(item.targetType, item.targetId, action, reason);
      showToast(
        action === 'mark'
          ? '已判定为疑似谣言'
          : action === 'reject'
            ? '已驳回谣言举报'
            : '已取消谣言标记',
        'success'
      );
      if (action === 'reject') {
        closeRejectModal();
      }
      await loadItems();
      onPendingCountChange?.();
    } catch (error) {
      showToast(error instanceof Error ? error.message : '操作失败', 'error');
    } finally {
      setActingId('');
    }
  };

  const handleAction = (item: RumorReviewItem, action: 'mark' | 'reject' | 'clear') => {
    if (action === 'reject') {
      setRejectModal({
        isOpen: true,
        item,
        reason: '',
      });
      return;
    }
    void submitAction(item, action);
  };

  const confirmReject = async () => {
    if (!rejectModal.item) {
      return;
    }
    const trimmedReason = rejectModal.reason.trim();
    if (!trimmedReason) {
      showToast('请输入驳回理由', 'warning');
      return;
    }
    await submitAction(rejectModal.item, 'reject', trimmedReason);
  };

  return (
    <section className="space-y-6">
      <div className="rounded-lg border-2 border-ink bg-white p-5 shadow-sketch-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="font-display text-2xl text-ink">谣言审核</h3>
            <p className="mt-1 font-sans text-sm text-pencil">
              单独处理“举报谣言”类内容。判定为疑似谣言后，帖子会显示审核提示，评论会改为警示折叠展示。
            </p>
          </div>
          {pendingPreviewCount > 0 && (
            <div className="rounded-full border-2 border-red-300 bg-red-50 px-4 py-2 text-sm font-bold text-red-700">
              当前有 {pendingPreviewCount} 项待审核
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-4 rounded-lg border-2 border-ink bg-white p-5 shadow-sketch-sm">
        <div className="flex flex-wrap gap-2">
          {([
            ['pending', '待审核'],
            ['suspected', '已标记'],
            ['rejected', '已驳回'],
          ] as Array<[RumorTab, string]>).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setTab(value);
                setPage(1);
              }}
              className={`rounded-full border-2 px-4 py-2 text-sm font-bold ${
                tab === value ? 'border-ink bg-highlight' : 'border-gray-200 bg-white hover:border-ink'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          {([
            ['all', '全部类型'],
            ['post', '帖子'],
            ['comment', '评论'],
          ] as Array<[RumorTargetFilter, string]>).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setTargetType(value);
                setPage(1);
              }}
              className={`rounded-full border px-3 py-1 text-xs font-bold ${
                targetType === value ? 'border-ink bg-marker-blue' : 'border-gray-200 bg-white hover:border-ink'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-pencil" />
          <input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="搜索内容、证据、ID..."
            className="w-full rounded-full border-2 border-ink bg-white py-2 pl-9 pr-4 text-sm outline-none"
          />
        </div>
      </div>

      {loading ? (
        <div className="rounded-lg border-2 border-dashed border-gray-200 bg-white p-10 text-center text-pencil">
          正在加载谣言审核列表...
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border-2 border-dashed border-gray-200 bg-white p-10 text-center text-pencil">
          当前筛选条件下暂无内容
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {items.map((item) => {
            const isComment = item.targetType === 'comment';
            const isActing = actingId === item.id;
            return (
              <article key={item.id} className="rounded-lg border-2 border-ink bg-white p-5 shadow-sketch-sm">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1 space-y-4">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <Badge color={isComment ? 'bg-marker-blue' : 'bg-marker-green'}>
                        {isComment ? '评论谣言' : '帖子谣言'}
                      </Badge>
                      <Badge color={item.rumorStatus === 'suspected' ? 'bg-alert' : item.rumorStatus === 'rejected' ? 'bg-gray-100' : 'bg-highlight'}>
                        {item.rumorStatus === 'suspected' ? '疑似谣言' : item.rumorStatus === 'rejected' ? '已驳回' : '待审核'}
                      </Badge>
                      <span className="font-sans text-pencil">目标：{item.id}</span>
                      <span className="font-sans text-pencil">举报数：{item.reportCount}</span>
                      <span className="font-sans text-pencil">待处理：{item.pendingReportCount}</span>
                      <span className="font-sans text-pencil">举报人：{item.reporterCount}</span>
                    </div>

                    <div className="flex flex-wrap gap-4 text-xs text-pencil">
                      <span>最新举报：{formatTime(item.latestReportedAt)}</span>
                      {item.rumorStatusUpdatedAt && <span>最近审核：{formatTime(item.rumorStatusUpdatedAt)}</span>}
                    </div>

                    {isComment && item.postContent && (
                      <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-3">
                        <div className="mb-2 flex items-center gap-2 text-xs font-bold text-pencil">
                          <FileText className="h-4 w-4" />
                          所属帖子
                        </div>
                        <div className="max-h-40 overflow-auto text-sm text-ink">
                          <MarkdownRenderer content={item.postContent} className="font-sans" />
                        </div>
                      </div>
                    )}

                    <div className="rounded-lg border border-orange-200 bg-orange-50/60 p-3">
                      <div className="mb-2 flex items-center gap-2 text-xs font-bold text-orange-700">
                        {isComment ? <MessageSquare className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                        {isComment ? '被举报评论' : '被举报帖子'}
                      </div>
                      <div className="max-h-56 overflow-auto text-sm text-ink">
                        <MarkdownRenderer content={item.targetContent || ''} className="font-sans" />
                      </div>
                    </div>

                    <div className="rounded-lg border border-red-200 bg-red-50/70 p-3">
                      <div className="mb-2 text-xs font-bold text-red-700">举报证据 / 说明</div>
                      {item.evidenceSamples.length > 0 ? (
                        <div className="flex flex-col gap-2">
                          {item.evidenceSamples.map((sample) => (
                            <div key={sample.reportId} className="rounded-lg border border-red-100 bg-white px-3 py-2">
                              <p className="whitespace-pre-wrap break-words text-sm text-ink">{sample.content}</p>
                              <p className="mt-1 text-xs text-pencil">提交时间：{formatTime(sample.createdAt)}</p>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-sm text-pencil">暂无补充证据</div>
                      )}
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-wrap gap-2 lg:w-[220px] lg:flex-col">
                    <SketchButton
                      type="button"
                      className="h-10 px-3 text-xs"
                      disabled={isActing}
                      onClick={() => handleAction(item, 'mark')}
                    >
                      <CheckCircle2 className="mr-1 inline h-4 w-4" />
                      判定疑似谣言
                    </SketchButton>
                    <SketchButton
                      type="button"
                      variant="secondary"
                      className="h-10 px-3 text-xs"
                      disabled={isActing}
                      onClick={() => handleAction(item, 'reject')}
                    >
                      <XCircle className="mr-1 inline h-4 w-4" />
                      驳回举报
                    </SketchButton>
                    {item.rumorStatus && (
                      <SketchButton
                        type="button"
                        variant="secondary"
                        className="h-10 px-3 text-xs"
                        disabled={isActing}
                        onClick={() => handleAction(item, 'clear')}
                      >
                        <RotateCcw className="mr-1 inline h-4 w-4" />
                        取消谣言标记
                      </SketchButton>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <div className="flex items-center justify-center gap-4 text-xs text-pencil">
        <SketchButton
          type="button"
          variant="secondary"
          className="px-4 py-2 text-sm"
          disabled={page <= 1}
          onClick={() => setPage((prev) => Math.max(prev - 1, 1))}
        >
          上一页
        </SketchButton>
        <span>第 {page} / {totalPages} 页</span>
        <SketchButton
          type="button"
          variant="secondary"
          className="px-4 py-2 text-sm"
          disabled={page >= totalPages}
          onClick={() => setPage((prev) => Math.min(prev + 1, totalPages))}
        >
          下一页
        </SketchButton>
      </div>

      <Modal
        isOpen={rejectModal.isOpen}
        onClose={closeRejectModal}
        title="驳回谣言举报"
        panelClassName="max-w-xl"
      >
        <div className="space-y-4">
          <div className="rounded-lg border border-orange-200 bg-orange-50/70 p-3">
            <div className="text-xs font-bold text-orange-700">
              {rejectModal.item?.targetType === 'comment' ? '被举报评论' : '被举报帖子'}
            </div>
            <div className="mt-2 max-h-40 overflow-auto text-sm text-ink">
              <MarkdownRenderer content={rejectModal.item?.targetContent || ''} className="font-sans" />
            </div>
          </div>

          <label className="block">
            <span className="mb-2 block text-sm font-bold text-ink">驳回理由</span>
            <textarea
              value={rejectModal.reason}
              onChange={(event) => setRejectModal((prev) => ({ ...prev, reason: event.target.value }))}
              placeholder="请输入驳回该谣言举报的原因，提交后会通知所有待处理举报人。"
              rows={4}
              className="w-full rounded-lg border-2 border-ink bg-white px-3 py-2 text-sm outline-none"
            />
          </label>

          <div className="flex justify-end gap-3">
            <SketchButton
              type="button"
              variant="secondary"
              className="px-4 py-2 text-sm"
              disabled={actingId === rejectModal.item?.id}
              onClick={closeRejectModal}
            >
              取消
            </SketchButton>
            <SketchButton
              type="button"
              className="px-4 py-2 text-sm"
              disabled={actingId === rejectModal.item?.id}
              onClick={() => {
                void confirmReject();
              }}
            >
              确认驳回
            </SketchButton>
          </div>
        </div>
      </Modal>
    </section>
  );
};

export default AdminRumorPanel;
