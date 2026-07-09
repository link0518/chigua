import React, { useEffect, useMemo, useRef } from 'react';

export type FrameSize = 'sm' | 'md' | 'lg';

export interface FrameRenderPayload {
  engine?: string;
  html?: string;
  css?: string;
  assets?: Record<string, string>;
  lottie?: { slot?: string; data?: string } | null;
}

export interface FrameRuntimeProps {
  frameId: string;
  render?: FrameRenderPayload | null;
  username?: string;
  timestamp?: string;
  size?: FrameSize;
  glyph?: string;
  className?: string;
  /** 炫彩昵称样式，注入到 .fg-name */
  nameStyleId?: string | null;
}

const SIZE_VARS: Record<FrameSize, string> = {
  sm: '--fg-avatar:32px;--fg-name-size:14px;--fg-pad:6px 10px;--fg-gap:8px;',
  md: '--fg-avatar:40px;--fg-name-size:16px;--fg-pad:8px 12px;--fg-gap:10px;',
  lg: '--fg-avatar:48px;--fg-name-size:18px;--fg-pad:10px 14px;--fg-gap:12px;',
};

/**
 * 固定插槽 + Shadow DOM 隔离 CSS 的头像框运行时。
 * 后台预览 / 商城 / 帖子作者区共用。
 */
const FrameRuntime: React.FC<FrameRuntimeProps & {
  nameStyleColor?: { r: number; g: number; b: number } | null;
}> = ({
  frameId,
  render,
  username = '匿名用户',
  timestamp = '',
  size = 'md',
  glyph = '瓜',
  className = '',
  nameStyleId = null,
  nameStyleColor = null,
}) => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const css = String(render?.css || '');
  const assets = render?.assets || {};
  const styleId = String(nameStyleId || '').trim();

  const assetCss = useMemo(() => {
    const lines = Object.entries(assets).map(([key, value]) => {
      const safeKey = String(key).replace(/[^a-zA-Z0-9_-]/g, '');
      if (!safeKey || !value) return '';
      // data URL 作为 CSS 变量
      return `--fg-asset-${safeKey}: url("${String(value).replace(/"/g, '')}");`;
    });
    return lines.filter(Boolean).join('');
  }, [assets]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const shadow = host.shadowRoot || host.attachShadow({ mode: 'open' });
    const sizeVars = SIZE_VARS[size] || SIZE_VARS.md;
    const safeName = escapeHtml(username);
    const safeTime = escapeHtml(timestamp);
    const safeGlyph = escapeHtml(glyph).slice(0, 2);
    const nameStyleAttr = styleId ? ` data-name-style="${escapeHtml(styleId)}"` : '';

    let nameStyleCss = '';
    if (nameStyleColor) {
      const { r, g, b } = nameStyleColor;
      nameStyleCss = `
        .fg-name[data-name-style] {
          color: rgb(${r}, ${g}, ${b}) !important;
          font-weight: 800 !important;
        }
      `;
    }

    shadow.innerHTML = `
      <style>
        :host { display: inline-block; max-width: 100%; vertical-align: middle; }
        .fg-root {
          display: inline-flex; align-items: center; position: relative;
          max-width: 100%; box-sizing: border-box;
          ${sizeVars}
          ${assetCss}
        }
        .fg-deco { position: absolute; inset: 0; pointer-events: none; }
        .fg-shell { box-sizing: border-box; }
        .fg-meta { min-width: 0; }
        .fg-name, .fg-time { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        ${css}
        ${nameStyleCss}
      </style>
      <div class="fg-root" data-size="${size}" data-frame-id="${escapeHtml(frameId)}">
        <div class="fg-shell" data-part="shell"></div>
        <div class="fg-deco" data-part="deco"></div>
        <div class="fg-avatar" data-part="avatar">
          <span class="fg-glyph" data-part="glyph">${safeGlyph}</span>
          <div class="fg-lottie" data-part="lottie"></div>
        </div>
        <div class="fg-meta" data-part="meta">
          <span class="fg-name" data-part="name"${nameStyleAttr}>${safeName}</span>
          ${safeTime ? `<span class="fg-time" data-part="time">${safeTime}</span>` : ''}
        </div>
      </div>
    `;
  }, [assetCss, css, frameId, glyph, nameStyleColor, size, styleId, timestamp, username]);

  if (!css) {
    return null;
  }

  return (
    <div
      ref={hostRef}
      className={className}
      data-frame-runtime={frameId}
      style={{ display: 'inline-block', maxWidth: '100%' }}
    />
  );
};

const escapeHtml = (value: string) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

export default FrameRuntime;
