import React from 'react';
import { UserX } from 'lucide-react';

import ColorfulName from './ColorfulName';
import FrameRuntime, { type FrameRenderPayload, type FrameSize } from './FrameRuntime';
import { getNameStyleDef, useNameStyleRegistryVersion } from './nameStyles';
import { getFrameDef, isNicknameFrameId, useFrameRegistryVersion } from './nicknameFrames';

interface NicknameFrameCardProps {
  frameId?: string | null;
  /** 炫彩昵称样式 id（如 vip-red） */
  nameStyleId?: string | null;
  username?: string;
  timestamp?: string;
  size?: FrameSize;
  className?: string;
  compact?: boolean;
  /** 直接传入 render（商城 catalog / 管理预览），优先于 registry */
  render?: FrameRenderPayload | null;
}

/**
 * 匿名用户昵称框：优先 FrameRuntime（DB 框包 CSS），无数据时降级朴素样式。
 */
const NicknameFrameCard: React.FC<NicknameFrameCardProps> = ({
  frameId,
  nameStyleId = null,
  username = '匿名用户',
  timestamp = '',
  size = 'md',
  className = '',
  compact = false,
  render = null,
}) => {
  // 目录异步到达时强制重渲染
  useFrameRegistryVersion();
  useNameStyleRegistryVersion();
  const id = String(frameId || '').trim();
  const def = id ? getFrameDef(id) : null;
  const payload = render || def?.render || null;
  const hasCss = Boolean(payload?.css);
  const nameColor = getNameStyleDef(nameStyleId)?.color || null;
  const styledName = (
    <ColorfulName styleId={nameStyleId} className="font-hand">
      {username}
    </ColorfulName>
  );

  if (compact) {
    if (hasCss && id) {
      // FrameRuntime 内部文字暂无法挂 React 样式节点；有框时昵称样式用外层叠加降级
      return (
        <span className={`inline-flex max-w-full items-center gap-1 ${className}`}>
          <FrameRuntime
            frameId={id}
            render={payload}
            username={username}
            timestamp=""
            size="sm"
            glyph={username.slice(0, 1) || '瓜'}
          />
        </span>
      );
    }
    return (
      <span className={`inline-flex max-w-full items-center text-xs font-hand font-bold text-gray-800 ${className}`}>
        {styledName}
      </span>
    );
  }

  if (hasCss && id) {
    return (
      <FrameRuntime
        frameId={id}
        render={payload}
        username={username}
        timestamp={timestamp}
        size={size}
        className={className}
        glyph="瓜"
        nameStyleId={nameStyleId}
        nameStyleColor={nameColor}
      />
    );
  }

  // 降级：无框数据（仍可有红名）
  const nameClass = size === 'md' || size === 'lg'
    ? 'font-hand text-xl font-bold text-pencil'
    : 'font-hand text-sm font-bold text-ink';

  return (
    <div className={`inline-flex max-w-full items-center gap-3 ${className}`}>
      <div className="flex size-10 shrink-0 items-center justify-center rounded-full border-2 border-black bg-gray-200 shadow-sm">
        <UserX className="h-5 w-5 text-pencil" />
      </div>
      <div className="flex min-w-0 flex-col">
        <span className={nameClass}>
          <ColorfulName styleId={nameStyleId}>{username}</ColorfulName>
        </span>
        {timestamp ? (
          <span className="font-mono text-xs text-gray-400">{timestamp}</span>
        ) : null}
      </div>
    </div>
  );
};

/**
 * 与信息流帖子作者区一致的预览。
 */
export const AnonymousAuthorPreview: React.FC<{
  frameId?: string | null;
  nameStyleId?: string | null;
  size?: FrameSize;
  timestamp?: string;
  className?: string;
  render?: FrameRenderPayload | null;
}> = ({
  frameId = null,
  nameStyleId = null,
  size = 'md',
  timestamp = '刚刚',
  className = '',
  render = null,
}) => {
  useFrameRegistryVersion();
  const id = String(frameId || '').trim();
  const usable = Boolean(render?.css) || isNicknameFrameId(id);

  if (usable && id) {
    return (
      <NicknameFrameCard
        frameId={id}
        nameStyleId={nameStyleId}
        username="匿名用户"
        timestamp={timestamp}
        size={size}
        className={className}
        render={render}
      />
    );
  }

  if (size === 'sm') {
    return (
      <div className={`inline-flex max-w-full items-center gap-2 text-sm text-pencil ${className}`}>
        <UserX className="h-4 w-4 shrink-0" />
        <span className="font-hand font-bold">
          <ColorfulName styleId={nameStyleId}>匿名用户</ColorfulName>
        </span>
        <span>•</span>
        <span>{timestamp}</span>
      </div>
    );
  }

  return (
    <div className={`inline-flex max-w-full items-center gap-3 ${className}`}>
      <div className="flex size-10 shrink-0 items-center justify-center rounded-full border-2 border-black bg-gray-200 shadow-sm">
        <UserX className="h-5 w-5 text-pencil" />
      </div>
      <div className="flex min-w-0 flex-col">
        <span className="font-hand text-xl font-bold text-pencil">
          <ColorfulName styleId={nameStyleId}>匿名用户</ColorfulName>
        </span>
        <span className="font-mono text-xs text-gray-400">{timestamp}</span>
      </div>
    </div>
  );
};

export default NicknameFrameCard;
