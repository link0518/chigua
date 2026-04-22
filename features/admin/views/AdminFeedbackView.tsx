import React from 'react';
import { Badge, SketchButton } from '@/components/SketchUI';
import type { FeedbackMessage } from '@/types';
import type {
  AdminFeedbackActionHandler,
  AdminFeedbackStatus,
  RenderIdentity,
} from '@/features/admin/types';

interface AdminFeedbackViewProps {
  feedbackStatus: AdminFeedbackStatus;
  feedbackTotal: number;
  feedbackPage: number;
  totalFeedbackPages: number;
  feedbackLoading: boolean;
  feedbackItems: FeedbackMessage[];
  formatTimestamp: (timestamp?: number) => string;
  renderIdentity: RenderIdentity;
  onFeedbackStatusChange: (status: AdminFeedbackStatus) => void;
  onFeedbackPageChange: (page: number) => void;
  onFeedbackRead: (feedbackId: string) => void;
  onOpenFeedbackAction: AdminFeedbackActionHandler;
}

const AdminFeedbackView: React.FC<AdminFeedbackViewProps> = ({
  feedbackStatus,
  feedbackTotal,
  feedbackPage,
  totalFeedbackPages,
  feedbackLoading,
  feedbackItems,
  formatTimestamp,
  renderIdentity,
  onFeedbackStatusChange,
  onFeedbackPageChange,
  onFeedbackRead,
  onOpenFeedbackAction,
}) => (
  <section>
    <div className="flex flex-col gap-3 mb-6">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs text-pencil font-sans">状态</span>
        {(['unread', 'read', 'all'] as const).map((status) => (
          <button
            key={status}
            onClick={() => onFeedbackStatusChange(status)}
            className={`px-3 py-1 text-xs font-bold rounded-full border-2 transition-all ${feedbackStatus === status ? 'border-ink bg-highlight' : 'border-transparent bg-white hover:border-ink'}`}
          >
            {status === 'unread' ? '未读' : status === 'read' ? '已读' : '全部'}
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between text-xs text-pencil font-sans">
        <span>共 {feedbackTotal} 条</span>
        <span>第 {feedbackPage} / {totalFeedbackPages} 页</span>
      </div>
    </div>

    {feedbackLoading ? (
      <div className="text-center py-16 bg-white border-2 border-ink rounded-lg">
        <span className="text-6xl mb-4 block">💬</span>
        <h3 className="font-display text-2xl text-ink mb-2">正在加载留言</h3>
        <p className="font-hand text-lg text-pencil">请稍等片刻</p>
      </div>
    ) : feedbackItems.length === 0 ? (
      <div className="text-center py-16 bg-white border-2 border-ink rounded-lg">
        <span className="text-6xl mb-4 block">📭</span>
        <h3 className="font-display text-2xl text-ink mb-2">暂无留言</h3>
        <p className="font-hand text-lg text-pencil">试试调整筛选条件</p>
      </div>
    ) : (
      <div className="flex flex-col gap-4">
        {feedbackItems.map((message) => (
          <div key={message.id} className="bg-white p-5 rounded-lg border-2 border-ink shadow-sketch-sm">
            <div className="flex flex-col md:flex-row gap-6 justify-between items-start">
              <div className="flex-1">
                <div className="flex flex-wrap items-center gap-3 text-xs font-sans text-pencil mb-2">
                  <span className="bg-gray-100 border border-ink text-ink text-[10px] font-bold px-2 py-0.5 rounded font-sans">ID: #{message.id}</span>
                  <span>{formatTimestamp(message.createdAt)}</span>
                  <Badge color={message.readAt ? 'bg-gray-200' : 'bg-highlight'}>
                    {message.readAt ? '已读' : '未读'}
                  </Badge>
                </div>
                <p className="text-ink text-base leading-relaxed font-sans font-semibold">"{message.content}"</p>
                <div className="flex flex-wrap items-center gap-4 text-xs text-pencil font-sans mt-3">
                  <span>邮箱：{message.email}</span>
                  {message.wechat && <span>微信：{message.wechat}</span>}
                  {message.qq && <span>QQ：{message.qq}</span>}
                  {renderIdentity(message)}
                </div>
              </div>
              <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 min-w-fit mt-2 md:mt-0 font-sans">
                {!message.readAt && (
                  <SketchButton
                    variant="secondary"
                    className="h-10 px-3 text-xs flex items-center gap-1"
                    onClick={() => onFeedbackRead(message.id)}
                  >
                    标记已读
                  </SketchButton>
                )}
                <SketchButton
                  variant="secondary"
                  className="h-10 px-3 text-xs flex items-center gap-1"
                  onClick={() => onOpenFeedbackAction(message, 'ban')}
                >
                  封禁
                </SketchButton>
                <SketchButton
                  variant="danger"
                  className="h-10 px-3 text-xs flex items-center gap-1"
                  onClick={() => onOpenFeedbackAction(message, 'delete')}
                >
                  删除
                </SketchButton>
              </div>
            </div>
          </div>
        ))}
      </div>
    )}

    {feedbackItems.length > 0 && (
      <div className="flex items-center justify-center gap-4 mt-6">
        <SketchButton
          variant="secondary"
          className="px-4 py-2 text-sm"
          disabled={feedbackPage <= 1}
          onClick={() => onFeedbackPageChange(Math.max(feedbackPage - 1, 1))}
        >
          上一页
        </SketchButton>
        <span className="text-xs text-pencil font-sans">第 {feedbackPage} / {totalFeedbackPages} 页</span>
        <SketchButton
          variant="secondary"
          className="px-4 py-2 text-sm"
          disabled={feedbackPage >= totalFeedbackPages}
          onClick={() => onFeedbackPageChange(Math.min(feedbackPage + 1, totalFeedbackPages))}
        >
          下一页
        </SketchButton>
      </div>
    )}
  </section>
);

export default AdminFeedbackView;
