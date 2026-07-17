import React from 'react';
import { CheckCircle, Trash2, XCircle } from 'lucide-react';
import { Badge, SketchButton } from '@/components/SketchUI';
import type { PostDeleteRequest } from '@/types';
import type {
  AdminPostDeleteRequestAction,
  AdminPostDeleteRequestStatus,
  RenderIdentity,
} from '@/features/admin/types';

interface AdminPostDeleteRequestsViewProps {
  status: AdminPostDeleteRequestStatus;
  total: number;
  page: number;
  totalPages: number;
  loading: boolean;
  items: PostDeleteRequest[];
  canManage: boolean;
  formatTimestamp: (timestamp?: number | null) => string;
  renderIdentity: RenderIdentity;
  onStatusChange: (status: AdminPostDeleteRequestStatus) => void;
  onPageChange: (page: number) => void;
  onOpenAction: (item: PostDeleteRequest, action: AdminPostDeleteRequestAction) => void;
}

const getStatusLabel = (status: PostDeleteRequest['status']) => {
  if (status === 'approved') {
    return '已通过';
  }
  if (status === 'rejected') {
    return '已驳回';
  }
  return '待处理';
};

const getStatusColor = (status: PostDeleteRequest['status']) => {
  if (status === 'approved') {
    return 'bg-green-100';
  }
  if (status === 'rejected') {
    return 'bg-red-100';
  }
  return 'bg-highlight';
};

const AdminPostDeleteRequestsView: React.FC<AdminPostDeleteRequestsViewProps> = ({
  status,
  total,
  page,
  totalPages,
  loading,
  items,
  canManage,
  formatTimestamp,
  renderIdentity,
  onStatusChange,
  onPageChange,
  onOpenAction,
}) => (
  <section>
    <div className="mb-6 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-sans text-xs text-pencil">队列</span>
        {(['pending', 'processed'] as const).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => onStatusChange(item)}
            className={`rounded-full border-2 px-3 py-1 text-xs font-bold transition-all ${status === item ? 'border-ink bg-highlight' : 'border-transparent bg-white hover:border-ink'}`}
          >
            {item === 'pending' ? '待处理' : '已处理'}
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between font-sans text-xs text-pencil">
        <span>共 {total} 条</span>
        <span>第 {page} / {totalPages} 页</span>
      </div>
    </div>

    {loading ? (
      <div className="rounded-lg border-2 border-ink bg-white py-16 text-center">
        <Trash2 className="mx-auto mb-4 h-12 w-12 text-pencil" />
        <h3 className="mb-2 font-display text-2xl text-ink">正在加载删除申请</h3>
        <p className="font-hand text-lg text-pencil">请稍等片刻</p>
      </div>
    ) : items.length === 0 ? (
      <div className="rounded-lg border-2 border-ink bg-white py-16 text-center">
        <CheckCircle className="mx-auto mb-4 h-12 w-12 text-pencil" />
        <h3 className="mb-2 font-display text-2xl text-ink">暂无删除申请</h3>
        <p className="font-hand text-lg text-pencil">当前队列没有需要处理的内容</p>
      </div>
    ) : (
      <div className="flex flex-col gap-4">
        {items.map((item) => (
          <div key={item.id} className="rounded-lg border-2 border-ink bg-white p-5 shadow-sketch-sm transition-all hover:shadow-sketch">
            <div className="flex flex-col items-start justify-between gap-6 md:flex-row">
              <div className="min-w-0 flex-1">
                <div className="mb-3 flex flex-wrap items-center gap-3">
                  <span className="rounded border border-ink bg-gray-100 px-2 py-0.5 font-sans text-[10px] font-bold text-ink">申请 #{item.id}</span>
                  <span className="font-sans text-xs font-bold text-pencil">{formatTimestamp(item.createdAt)}</span>
                  <Badge color={getStatusColor(item.status)}>
                    {getStatusLabel(item.status)}
                  </Badge>
                  {item.postDeleted && <Badge color="bg-gray-200">帖子已删除</Badge>}
                  {item.postHidden && <Badge color="bg-yellow-100">帖子已隐藏</Badge>}
                </div>

                <div className="mb-3 rounded-lg border border-dashed border-ink/40 bg-gray-50 p-3">
                  <div className="mb-1 font-sans text-[11px] text-pencil">帖子 #{item.postId}</div>
                  <p className="line-clamp-3 whitespace-pre-wrap break-words font-sans text-sm text-ink">
                    {item.postContent || '（帖子内容不可用）'}
                  </p>
                </div>

                <div className="rounded-lg border border-ink/20 bg-highlight/10 p-3">
                  <p className="mb-1 font-sans text-[11px] font-bold text-pencil">申请原因</p>
                  <p className="whitespace-pre-wrap break-words font-sans text-sm font-semibold text-ink">
                    {item.reason}
                  </p>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-4 font-sans text-xs text-pencil">
                  {renderIdentity({
                    ip: item.requesterIp,
                    fingerprint: item.requesterFingerprint,
                    identityKey: item.identityKey,
                    identityHashes: item.identityHashes,
                  }, { label: '申请人' })}
                  {item.reviewedAt && <span>处理时间 {formatTimestamp(item.reviewedAt)}</span>}
                  {item.reviewedByUsername && <span>处理人 {item.reviewedByUsername}</span>}
                </div>

                {item.reviewReason && (
                  <div className="mt-3 rounded-lg border border-dashed border-ink/30 bg-white p-3 font-sans text-xs text-pencil">
                    <span className="font-bold text-ink">处理说明：</span>
                    <span className="whitespace-pre-wrap break-words">{item.reviewReason}</span>
                  </div>
                )}
              </div>

              {item.status === 'pending' && (
                <div className="flex min-w-fit flex-wrap items-center gap-2 font-sans md:mt-2">
                  <SketchButton
                    variant="primary"
                    className="h-10 px-3 text-xs text-white"
                    disabled={!canManage}
                    onClick={() => onOpenAction(item, 'approve')}
                  >
                    <CheckCircle size={14} /> 通过删除
                  </SketchButton>
                  <SketchButton
                    variant="secondary"
                    className="h-10 px-3 text-xs"
                    disabled={!canManage}
                    onClick={() => onOpenAction(item, 'reject')}
                  >
                    <XCircle size={14} /> 驳回
                  </SketchButton>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    )}

    {items.length > 0 && (
      <div className="mt-6 flex items-center justify-center gap-4">
        <SketchButton
          variant="secondary"
          className="px-4 py-2 text-sm"
          disabled={page <= 1}
          onClick={() => onPageChange(Math.max(page - 1, 1))}
        >
          上一页
        </SketchButton>
        <span className="font-sans text-xs text-pencil">第 {page} / {totalPages} 页</span>
        <SketchButton
          variant="secondary"
          className="px-4 py-2 text-sm"
          disabled={page >= totalPages}
          onClick={() => onPageChange(Math.min(page + 1, totalPages))}
        >
          下一页
        </SketchButton>
      </div>
    )}
  </section>
);

export default AdminPostDeleteRequestsView;
