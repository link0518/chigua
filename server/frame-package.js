/**
 * Frame Package schemaVersion 2 — 校验与 CSS 消毒（无任意 JS）
 * 固定插槽引擎 css-slots-v1
 */

import { resolvePriceTiersFromRow } from './shop-inventory.js';

const ID_RE = /^[a-z][a-z0-9-]{1,31}$/;
const RARITIES = new Set(['common', 'rare', 'epic']);
const STATUSES = new Set(['on_sale', 'off_sale', 'hidden']);
const ENGINES = new Set(['css-slots-v1']);
const HTML_PRESETS = new Set(['default-v1']);
const MAX_CSS_LEN = 100_000;
const MAX_NAME_LEN = 16;
const MAX_PRICE = 999_999;

const FORBIDDEN_CSS = [
  /@import/i,
  /expression\s*\(/i,
  /javascript\s*:/i,
  /-moz-binding/i,
  /behavior\s*:/i,
  /url\s*\(\s*['"]?\s*https?:/i,
  /url\s*\(\s*['"]?\s*\/\//i,
  /url\s*\(\s*['"]?\s*data:\s*text\/html/i,
  /position\s*:\s*fixed/i,
  /<\/?script/i,
];

export class FramePackageError extends Error {
  constructor(message, path = '') {
    super(message);
    this.name = 'FramePackageError';
    this.path = path;
    this.status = 400;
  }
}

const isPlainObject = (value) => value != null && typeof value === 'object' && !Array.isArray(value);

const assert = (cond, message, path = '') => {
  if (!cond) {
    throw new FramePackageError(message, path);
  }
};

/**
 * 消毒 CSS：禁止危险语法；为 keyframes 加 frameId 前缀避免冲突。
 * 实际隔离由前端 Shadow DOM 完成，此处不再整体包选择器（避免破坏 @keyframes）。
 */
export const sanitizeFrameCss = (rawCss, frameId) => {
  const css = String(rawCss || '');
  assert(css.length <= MAX_CSS_LEN, 'CSS 过长', 'render.css');
  for (const rule of FORBIDDEN_CSS) {
    assert(!rule.test(css), `CSS 包含禁止内容: ${rule}`, 'render.css');
  }

  const id = String(frameId || 'frame').replace(/[^a-z0-9-]/gi, '');
  let out = css;
  const keyframeNames = new Set();
  out = out.replace(/@keyframes\s+([A-Za-z_][\w-]*)/g, (_m, name) => {
    const next = String(name).startsWith(`${id}-`) ? name : `${id}-${name}`;
    keyframeNames.add(name);
    keyframeNames.add(next);
    return `@keyframes ${next}`;
  });
  // 替换 animation / animation-name 中的裸名称
  out = out.replace(
    /(animation(?:-name)?\s*:\s*)([^;}+{]+)/gi,
    (full, prefix, value) => {
      let v = value;
      keyframeNames.forEach((name) => {
        if (String(name).startsWith(`${id}-`)) return;
        const re = new RegExp(`\\b${name}\\b`, 'g');
        v = v.replace(re, `${id}-${name}`);
      });
      // 常见默认名也处理一遍（从 @keyframes 重写后的源名）
      return `${prefix}${v}`;
    }
  );

  return out;
};

const normalizeFrameMeta = (raw, path = 'frame') => {
  assert(isPlainObject(raw), 'frame 必须是对象', path);
  const id = String(raw.id || '').trim();
  assert(ID_RE.test(id), 'id 格式非法（^[a-z][a-z0-9-]{1,31}$）', `${path}.id`);
  const name = String(raw.name || '').trim();
  assert(name.length > 0 && name.length <= MAX_NAME_LEN, `名称长度 1～${MAX_NAME_LEN}`, `${path}.name`);
  const price = Number(raw.price);
  assert(Number.isInteger(price) && price >= 0 && price <= MAX_PRICE, '价格非法', `${path}.price`);
  const rarity = String(raw.rarity || 'common').trim();
  assert(RARITIES.has(rarity), 'rarity 非法', `${path}.rarity`);
  const status = String(raw.status || 'on_sale').trim();
  assert(STATUSES.has(status), 'status 非法', `${path}.status`);
  const sort = Number(raw.sort ?? 100);
  assert(Number.isFinite(sort), 'sort 非法', `${path}.sort`);
  const grantOnRegister = Boolean(raw.grantOnRegister);
  return {
    id,
    name,
    price,
    rarity,
    status,
    sort: Math.trunc(sort),
    grantOnRegister,
  };
};

const normalizeRender = (raw, frameId, path = 'render') => {
  assert(isPlainObject(raw), 'render 必须是对象', path);
  const engine = String(raw.engine || 'css-slots-v1').trim();
  assert(ENGINES.has(engine), '不支持的 render.engine', `${path}.engine`);
  const html = String(raw.html || 'default-v1').trim();
  assert(HTML_PRESETS.has(html), '不支持的 render.html', `${path}.html`);

  let css = '';
  if (typeof raw.css === 'string') {
    css = raw.css;
  } else if (raw.cssFile) {
    throw new FramePackageError('zip/cssFile 请先展开为 render.css 再导入', `${path}.cssFile`);
  }
  assert(css.trim().length > 0, 'render.css 不能为空', `${path}.css`);

  const sanitizedCss = sanitizeFrameCss(css, frameId);

  const assets = isPlainObject(raw.assets) ? raw.assets : {};
  const normalizedAssets = {};
  for (const [key, value] of Object.entries(assets)) {
    const k = String(key || '').trim();
    assert(/^[a-zA-Z][\w-]{0,31}$/.test(k), 'asset key 非法', `${path}.assets`);
    const v = String(value || '').trim();
    // 仅允许 data URL 图片或包内占位
    assert(
      /^data:image\/(png|jpeg|jpg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(v)
      || /^data:application\/json;base64,[A-Za-z0-9+/=]+$/.test(v)
      || v.startsWith('asset:'),
      'asset 仅支持 data:image/*;base64 或 asset: 占位',
      `${path}.assets.${k}`
    );
    assert(v.length <= 400_000, '单个 asset 过大', `${path}.assets.${k}`);
    normalizedAssets[k] = v;
  }

  let lottie = null;
  if (raw.lottie != null) {
    assert(isPlainObject(raw.lottie), 'lottie 必须是对象', `${path}.lottie`);
    const slot = String(raw.lottie.slot || 'lottie').trim();
    const data = String(raw.lottie.data || raw.lottie.file || '').trim();
    assert(data.length > 0, 'lottie.data 不能为空', `${path}.lottie`);
    // 内嵌 JSON 字符串或 data URL
    lottie = { slot, data: data.slice(0, 500_000) };
  }

  return {
    engine,
    html,
    css: sanitizedCss,
    cssSource: css,
    assets: normalizedAssets,
    lottie,
    sizePresets: Array.isArray(raw.sizePresets) ? raw.sizePresets.map(String) : ['sm', 'md', 'lg'],
  };
};

/**
 * 校验并规范化框包。接受完整 package 或仅 frame 对象（兼容）。
 * @returns {{ frame, render, preview, schemaVersion }}
 */
export const validateFramePackage = (input) => {
  let raw = input;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      throw new FramePackageError('JSON 解析失败', '');
    }
  }
  assert(isPlainObject(raw), '框包必须是 JSON 对象', '');

  // 兼容：直接传 frame + render 顶层
  const schemaVersion = Number(raw.schemaVersion || 2);
  assert(schemaVersion === 2, '仅支持 schemaVersion: 2', 'schemaVersion');

  const frameRaw = raw.frame || raw;
  const renderRaw = raw.render || raw.frame?.theme || raw.theme;
  assert(renderRaw, '缺少 render（或 theme）', 'render');

  const frame = normalizeFrameMeta(frameRaw, raw.frame ? 'frame' : '');
  const render = normalizeRender(renderRaw, frame.id, raw.render ? 'render' : 'theme');

  const preview = isPlainObject(raw.preview)
    ? {
      username: String(raw.preview.username || '匿名用户').slice(0, 32),
      timestamp: String(raw.preview.timestamp || '刚刚').slice(0, 32),
    }
    : { username: '匿名用户', timestamp: '刚刚' };

  return {
    schemaVersion: 2,
    frame,
    render,
    preview,
  };
};

export const packageToRowFields = (pkg) => {
  const { frame, render, preview, schemaVersion } = pkg;
  return {
    id: frame.id,
    name: frame.name,
    price: frame.price,
    rarity: frame.rarity,
    status: frame.status,
    sort: frame.sort,
    grant_on_register: frame.grantOnRegister ? 1 : 0,
    package_json: JSON.stringify({
      schemaVersion,
      frame,
      render: {
        engine: render.engine,
        html: render.html,
        css: render.cssSource,
        assets: render.assets,
        lottie: render.lottie,
        sizePresets: render.sizePresets,
      },
      preview,
    }),
    theme_css: render.css,
    package_revision: 1,
  };
};

/** 从 DB 行还原可公开的渲染载荷 */
export const publicFrameFromRow = (row) => {
  if (!row) return null;
  let pkg = null;
  try {
    pkg = JSON.parse(row.package_json || '{}');
  } catch {
    pkg = {};
  }
  const priceTiers = resolvePriceTiersFromRow(row);
  const primary = priceTiers[0] || {
    price: Number(row.price || 0),
    durationDays: Math.max(0, Math.trunc(Number(row.duration_days || 0))),
  };

  return {
    id: row.id,
    name: row.name,
    price: Number(primary.price ?? row.price ?? 0),
    rarity: row.rarity || 'common',
    status: row.status || 'on_sale',
    sort: Number(row.sort || 0),
    grantOnRegister: Number(row.grant_on_register || 0) === 1,
    /** 有效期（天），0=永久；主档兼容字段 */
    durationDays: Math.max(0, Math.trunc(Number(primary.durationDays ?? row.duration_days ?? 0))),
    /** 阶梯定价：[{ id, price, durationDays, label }] */
    priceTiers,
    packageRevision: Number(row.package_revision || 1),
    render: {
      engine: 'css-slots-v1',
      html: 'default-v1',
      css: row.theme_css || pkg?.render?.css || '',
      assets: pkg?.render?.assets || {},
      lottie: pkg?.render?.lottie || null,
    },
  };
};

export const exportPackageFromRow = (row) => {
  try {
    const parsed = JSON.parse(row.package_json || '{}');
    if (parsed.schemaVersion && parsed.frame && parsed.render) {
      return parsed;
    }
  } catch {
    // fallthrough
  }
  return {
    schemaVersion: 2,
    frame: {
      id: row.id,
      name: row.name,
      price: Number(row.price || 0),
      rarity: row.rarity,
      status: row.status,
      sort: Number(row.sort || 0),
      grantOnRegister: Number(row.grant_on_register || 0) === 1,
    },
    render: {
      engine: 'css-slots-v1',
      html: 'default-v1',
      css: row.theme_css || '',
      assets: {},
      lottie: null,
    },
    preview: { username: '匿名用户', timestamp: '刚刚' },
  };
};

/** 内置三框 seed CSS（复杂动效示例） */
export const BUILTIN_SEED_PACKAGES = [
  {
    schemaVersion: 2,
    frame: {
      id: 'melon-pop',
      name: '西瓜汽水',
      price: 40,
      rarity: 'common',
      status: 'on_sale',
      sort: 10,
      grantOnRegister: false,
    },
    render: {
      engine: 'css-slots-v1',
      html: 'default-v1',
      css: `
.fg-root { display: inline-flex; align-items: center; gap: 10px; padding: 8px 12px; position: relative; }
.fg-shell {
  position: absolute; inset: 0; border-radius: 16px; border: 1px solid rgba(52,211,153,.5);
  background: linear-gradient(135deg, rgba(190,242,100,.35), rgba(167,243,208,.35), rgba(165,243,252,.3));
  box-shadow: 0 8px 18px -10px rgba(16,185,129,.45); overflow: hidden;
}
.fg-shell::after {
  content: ''; position: absolute; top: 0; left: -40%; width: 50%; height: 100%;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,.5), transparent);
  transform: skewX(-20deg); animation: shine 2.8s ease-in-out infinite;
}
.fg-avatar {
  position: relative; z-index: 1; width: var(--fg-avatar, 40px); height: var(--fg-avatar, 40px);
  border-radius: 12px; border: 2px solid rgba(15,23,42,.75); overflow: hidden;
  background: linear-gradient(135deg, #bef264, #6ee7b7, #5eead4);
  display: flex; align-items: center; justify-content: center;
}
.fg-glyph { color: #fff; font-weight: 900; font-size: calc(var(--fg-avatar, 40px) * 0.38); text-shadow: 0 1px 2px rgba(0,0,0,.2); }
.fg-meta { position: relative; z-index: 1; display: flex; flex-direction: column; min-width: 0; }
.fg-name { font-weight: 700; color: #0f172a; font-size: var(--fg-name-size, 16px); line-height: 1.1; }
.fg-time { color: #6b7280; font-size: 11px; margin-top: 2px; }
@keyframes shine {
  0% { left: -50%; } 60%, 100% { left: 120%; }
}
`.trim(),
    },
    preview: { username: '匿名用户', timestamp: '刚刚' },
  },
  {
    schemaVersion: 2,
    frame: {
      id: 'ink-sketch',
      name: '墨线手账',
      price: 60,
      rarity: 'common',
      status: 'on_sale',
      sort: 20,
      grantOnRegister: false,
    },
    render: {
      engine: 'css-slots-v1',
      html: 'default-v1',
      css: `
.fg-root { display: inline-flex; align-items: center; gap: 10px; padding: 8px 12px; position: relative; }
.fg-shell {
  position: absolute; inset: 0; border: 2px solid #0f172a; background: #fff;
  border-radius: 18px 12px 20px 10px / 12px 18px 10px 20px;
  box-shadow: 3px 3px 0 0 #0f172a;
}
.fg-shell::after {
  content: ''; position: absolute; left: 8px; right: 8px; bottom: 4px; height: 6px;
  border-radius: 999px; background: rgba(253,224,71,.65);
}
.fg-avatar {
  position: relative; z-index: 1; width: var(--fg-avatar, 40px); height: var(--fg-avatar, 40px);
  border-radius: 12px; border: 2px solid #0f172a; background: #fff;
  display: flex; align-items: center; justify-content: center;
}
.fg-glyph { color: #0f172a; font-weight: 900; font-size: calc(var(--fg-avatar, 40px) * 0.34); }
.fg-meta { position: relative; z-index: 1; display: flex; flex-direction: column; min-width: 0; }
.fg-name { font-weight: 700; color: #0f172a; font-size: var(--fg-name-size, 16px); line-height: 1.1; }
.fg-time { color: #6b7280; font-size: 11px; margin-top: 2px; }
`.trim(),
    },
    preview: { username: '匿名用户', timestamp: '刚刚' },
  },
  {
    schemaVersion: 2,
    frame: {
      id: 'candy-tape',
      name: '胶带便签',
      price: 50,
      rarity: 'common',
      status: 'on_sale',
      sort: 30,
      grantOnRegister: false,
    },
    render: {
      engine: 'css-slots-v1',
      html: 'default-v1',
      css: `
.fg-root { display: inline-flex; align-items: center; gap: 10px; padding: 10px 12px; position: relative; }
.fg-shell {
  position: absolute; inset: 0; border-radius: 12px; border: 1px solid rgba(249,168,212,.7);
  background: #fff8fb; box-shadow: 0 6px 14px -8px rgba(244,114,182,.45);
}
.fg-deco::before, .fg-deco::after {
  content: ''; position: absolute; height: 12px; border-radius: 2px; z-index: 2;
}
.fg-deco::before {
  top: -6px; left: 14px; width: 40px; background: rgba(249,168,212,.85); transform: rotate(-6deg);
  animation: tape-wiggle 3s ease-in-out infinite;
}
.fg-deco::after {
  bottom: -6px; right: 16px; width: 32px; background: rgba(253,230,138,.9); transform: rotate(8deg);
}
.fg-avatar {
  position: relative; z-index: 1; width: var(--fg-avatar, 40px); height: var(--fg-avatar, 40px);
  border-radius: 12px; border: 2px solid rgba(15,23,42,.75);
  background: linear-gradient(135deg, #fbcfe8, #fecdd3, #fef3c7);
  display: flex; align-items: center; justify-content: center;
}
.fg-glyph { color: #9d174d; font-weight: 900; font-size: calc(var(--fg-avatar, 40px) * 0.38); }
.fg-meta { position: relative; z-index: 1; display: flex; flex-direction: column; min-width: 0; }
.fg-name { font-weight: 700; color: #0f172a; font-size: var(--fg-name-size, 16px); line-height: 1.1; }
.fg-time { color: #6b7280; font-size: 11px; margin-top: 2px; }
@keyframes tape-wiggle {
  0%, 100% { transform: rotate(-6deg); }
  50% { transform: rotate(-3deg); }
}
`.trim(),
    },
    preview: { username: '匿名用户', timestamp: '刚刚' },
  },
  {
    schemaVersion: 2,
    frame: {
      id: 'aurora-prism',
      name: '极光棱镜',
      price: 180,
      rarity: 'epic',
      status: 'on_sale',
      sort: 5,
      grantOnRegister: false,
    },
    render: {
      engine: 'css-slots-v1',
      html: 'default-v1',
      css: `
/* 高级动效框：旋转棱镜描边 + 呼吸光晕 + 流光扫过 + 漂浮微粒 */
.fg-root {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px 10px 12px;
  position: relative;
  isolation: isolate;
}
.fg-shell {
  position: absolute;
  inset: -2px;
  border-radius: 18px;
  overflow: hidden;
  z-index: 0;
  background: #0b1020;
  box-shadow:
    0 0 0 1px rgba(255,255,255,.08),
    0 10px 28px -12px rgba(56,189,248,.55),
    0 0 36px -8px rgba(167,139,250,.45);
  animation: shell-breathe 3.2s ease-in-out infinite;
}
/* 旋转极光环（conic-gradient） */
.fg-shell::before {
  content: '';
  position: absolute;
  inset: -40%;
  background: conic-gradient(
    from 0deg,
    #22d3ee,
    #a78bfa,
    #f472b6,
    #fbbf24,
    #34d399,
    #22d3ee
  );
  animation: prism-spin 4.5s linear infinite;
  opacity: .95;
}
/* 内底遮罩，只露出细描边 */
.fg-shell::after {
  content: '';
  position: absolute;
  inset: 2px;
  border-radius: 16px;
  background:
    radial-gradient(120% 80% at 20% 0%, rgba(56,189,248,.22), transparent 55%),
    radial-gradient(100% 90% at 90% 100%, rgba(167,139,250,.2), transparent 50%),
    linear-gradient(145deg, #111827 0%, #0b1224 48%, #1a1030 100%);
  z-index: 1;
}
/* 斜向流光 */
.fg-deco {
  position: absolute;
  inset: 0;
  border-radius: 18px;
  overflow: hidden;
  z-index: 2;
  pointer-events: none;
}
.fg-deco::before {
  content: '';
  position: absolute;
  top: -20%;
  left: -60%;
  width: 45%;
  height: 140%;
  background: linear-gradient(
    100deg,
    transparent 0%,
    rgba(255,255,255,.08) 40%,
    rgba(255,255,255,.55) 50%,
    rgba(255,255,255,.08) 60%,
    transparent 100%
  );
  transform: skewX(-18deg);
  animation: aurora-sweep 3.6s ease-in-out infinite;
}
/* 漂浮星点（多层 box-shadow） */
.fg-deco::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 18px;
  background:
    radial-gradient(2px 2px at 18% 28%, rgba(255,255,255,.95), transparent),
    radial-gradient(1.5px 1.5px at 72% 22%, rgba(125,211,252,.9), transparent),
    radial-gradient(1.5px 1.5px at 58% 68%, rgba(244,114,182,.85), transparent),
    radial-gradient(1px 1px at 34% 74%, rgba(253,224,71,.8), transparent),
    radial-gradient(1.5px 1.5px at 86% 56%, rgba(167,243,208,.85), transparent);
  animation: star-twinkle 2.4s ease-in-out infinite alternate;
  opacity: .85;
  z-index: 2;
}
.fg-avatar {
  position: relative;
  z-index: 3;
  width: var(--fg-avatar, 40px);
  height: var(--fg-avatar, 40px);
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border: 1px solid rgba(255,255,255,.35);
  background:
    linear-gradient(145deg, rgba(34,211,238,.35), rgba(167,139,250,.4) 45%, rgba(244,114,182,.35));
  box-shadow:
    inset 0 0 12px rgba(255,255,255,.25),
    0 0 16px rgba(56,189,248,.35);
  animation: avatar-glow 2.8s ease-in-out infinite;
}
.fg-avatar::before {
  content: '';
  position: absolute;
  inset: -30%;
  background: conic-gradient(from 90deg, transparent, rgba(255,255,255,.45), transparent 35%);
  animation: prism-spin 6s linear infinite reverse;
  opacity: .55;
}
.fg-glyph {
  position: relative;
  z-index: 1;
  color: #fff;
  font-weight: 900;
  font-size: calc(var(--fg-avatar, 40px) * 0.4);
  letter-spacing: -.02em;
  text-shadow:
    0 0 8px rgba(125,211,252,.9),
    0 0 16px rgba(167,139,250,.7),
    0 1px 2px rgba(0,0,0,.35);
  animation: glyph-pulse 2s ease-in-out infinite;
}
.fg-meta {
  position: relative;
  z-index: 3;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.fg-name {
  font-weight: 800;
  font-size: var(--fg-name-size, 16px);
  line-height: 1.15;
  background: linear-gradient(90deg, #a5f3fc, #e9d5ff, #fbcfe8, #a5f3fc);
  background-size: 220% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  animation: name-flow 3.5s linear infinite;
  filter: drop-shadow(0 0 6px rgba(125,211,252,.35));
}
.fg-time {
  margin-top: 3px;
  font-size: 11px;
  color: rgba(186,198,220,.85);
  letter-spacing: .02em;
}
@keyframes prism-spin {
  to { transform: rotate(360deg); }
}
@keyframes aurora-sweep {
  0% { left: -70%; opacity: 0; }
  15% { opacity: 1; }
  55% { left: 120%; opacity: 1; }
  100% { left: 130%; opacity: 0; }
}
@keyframes shell-breathe {
  0%, 100% {
    box-shadow:
      0 0 0 1px rgba(255,255,255,.08),
      0 10px 28px -12px rgba(56,189,248,.5),
      0 0 28px -8px rgba(167,139,250,.35);
  }
  50% {
    box-shadow:
      0 0 0 1px rgba(255,255,255,.14),
      0 12px 32px -10px rgba(56,189,248,.75),
      0 0 42px -4px rgba(244,114,182,.45);
  }
}
@keyframes avatar-glow {
  0%, 100% { box-shadow: inset 0 0 12px rgba(255,255,255,.2), 0 0 12px rgba(56,189,248,.3); }
  50% { box-shadow: inset 0 0 16px rgba(255,255,255,.35), 0 0 22px rgba(167,139,250,.55); }
}
@keyframes glyph-pulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.06); opacity: .92; }
}
@keyframes name-flow {
  0% { background-position: 0% 50%; }
  100% { background-position: 220% 50%; }
}
@keyframes star-twinkle {
  0% { opacity: .45; transform: translateY(0); }
  100% { opacity: 1; transform: translateY(-1px); }
}
`.trim(),
    },
    preview: { username: '匿名用户', timestamp: '刚刚' },
  },
];
