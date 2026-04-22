import React from 'react';
import { Badge, SketchButton } from '@/components/SketchUI';
import type { AdminMergedBanItem, AdminBanType, RenderIdentity } from '@/features/admin/types';

interface AdminBansViewProps {
  mergedBans: AdminMergedBanItem[];
  banLoading: boolean;
  banSearch: string;
  formatTimestamp: (timestamp?: number) => string;
  formatBanPermissions: (permissions?: string[]) => string;
  renderIdentity: RenderIdentity;
  onBanSearchChange: (value: string) => void;
  onOpenManualBan: (preset?: { type?: AdminBanType; value?: string }) => void;
  onEditBan: (item: AdminMergedBanItem) => void;
}

const AdminBansView: React.FC<AdminBansViewProps> = ({
  mergedBans,
  banLoading,
  banSearch,
  formatTimestamp,
  formatBanPermissions,
  renderIdentity,
  onBanSearchChange,
  onOpenManualBan,
  onEditBan,
}) => (
  <section>
    <div className="flex flex-col gap-3 mb-4">
      <div className="flex items-center justify-between gap-3 text-xs text-pencil font-sans">
        <span>共 {mergedBans.length} 条</span>
        <div className="flex items-center gap-2">
          <span>{banLoading ? '加载中...' : '已更新'}</span>
          <SketchButton
            variant="secondary"
            className="h-8 px-3 text-xs"
            onClick={() => onOpenManualBan()}
          >
            新建封禁
          </SketchButton>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <input
          value={banSearch}
          onChange={(e) => onBanSearchChange(e.target.value)}
          placeholder="搜索 IP / 身份 / 理由 / 权限..."
          className="w-full h-9 border-2 border-gray-200 rounded-lg px-3 text-xs font-sans focus:border-ink outline-none"
        />
      </div>
    </div>

    <div className="bg-white border-2 border-ink rounded-lg p-4 shadow-sketch-sm mb-4 flex flex-col gap-3">
      <p className="text-sm font-bold text-ink font-sans">统一处置入口</p>
      <p className="text-xs text-pencil font-sans leading-6">
        手动封禁、更新权限、调整时长、解除封禁都在同一个处置抽屉里完成。
      </p>
      <div className="flex flex-wrap gap-2">
        <SketchButton
          variant="secondary"
          className="h-8 px-3 text-xs"
          onClick={() => onOpenManualBan({ type: 'identity', value: banSearch.trim() })}
        >
          按身份处理
        </SketchButton>
        <SketchButton
          variant="secondary"
          className="h-8 px-3 text-xs"
          onClick={() => onOpenManualBan({ type: 'ip', value: banSearch.trim() })}
        >
          按 IP 处理
        </SketchButton>
      </div>
    </div>

    {banLoading ? (
      <div className="text-center py-16 bg-white border-2 border-ink rounded-lg">
        <span className="text-6xl mb-4 block">⏳</span>
        <h3 className="font-display text-2xl text-ink mb-2">正在加载封禁列表</h3>
        <p className="font-hand text-lg text-pencil">请稍等片刻</p>
      </div>
    ) : mergedBans.length === 0 ? (
      <div className="text-center py-16 bg-white border-2 border-ink rounded-lg">
        <span className="text-6xl mb-4 block">🛡️</span>
        <h3 className="font-display text-2xl text-ink mb-2">暂无封禁</h3>
        <p className="font-hand text-lg text-pencil">试试调整搜索条件</p>
      </div>
    ) : (
      <div className="flex flex-col gap-4">
        {mergedBans.map((item) => (
          <div key={`${item.type}-${item.value}`} className="bg-white p-5 rounded-lg border-2 border-ink shadow-sketch-sm">
            <div className="flex flex-col md:flex-row gap-4 justify-between">
              <div className="flex-1">
                <div className="flex flex-wrap items-center gap-3 text-xs font-sans text-pencil mb-2">
                  <Badge color="bg-gray-200">
                    {item.type === 'ip' ? 'IP' : item.type === 'fingerprint' ? '指纹' : '身份'}
                  </Badge>
                  {item.type !== 'ip' ? (
                    renderIdentity({
                      identityKey: item.identityKey || null,
                      identityHashes: item.identityHashes || [],
                      fingerprint: item.fingerprint || null,
                      ip: item.type === 'ip' ? item.value : null,
                    }, {
                      label: null,
                      textClassName: 'text-xs font-bold text-ink',
                      enableBanActions: false,
                    })
                  ) : (
                    <span className="text-xs font-bold text-ink break-all">{item.value}</span>
                  )}
                  <span>{formatTimestamp(item.bannedAt)}</span>
                </div>
                <div className="text-xs text-pencil font-sans space-y-1">
                  <p>权限：{formatBanPermissions(item.permissions)}</p>
                  <p>到期：{item.expiresAt ? formatTimestamp(item.expiresAt) : '永久'}</p>
                  {item.reason && <p>理由：{item.reason}</p>}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <SketchButton
                  variant="secondary"
                  className="h-8 px-3 text-xs"
                  onClick={() => onEditBan(item)}
                >
                  处理
                </SketchButton>
              </div>
            </div>
          </div>
        ))}
      </div>
    )}
  </section>
);

export default AdminBansView;
