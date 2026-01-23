const STORAGE_KEY = 'gossipsketch_fingerprint';
let fingerprintPromise: Promise<string> | null = null;

const safeNumber = (value: number | undefined | null) => (Number.isFinite(value) ? value : 0);

const getCanvasFingerprint = () => {
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    const text = 'gossipsketch@2025';
    ctx.textBaseline = 'top';
    ctx.font = '14px Arial';
    ctx.fillStyle = '#f60';
    ctx.fillRect(125, 1, 62, 20);
    ctx.fillStyle = '#069';
    ctx.fillText(text, 2, 15);
    ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
    ctx.fillText(text, 4, 17);
    return canvas.toDataURL();
  } catch {
    return '';
  }
};

const buildFingerprintSource = () => {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return 'unknown';
  }
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  const screenInfo = typeof screen === 'undefined'
    ? ''
    : `${screen.width}x${screen.height}x${screen.colorDepth}`;
  const deviceMemory = 'deviceMemory' in navigator
    ? (navigator as { deviceMemory?: number }).deviceMemory
    : undefined;
  return JSON.stringify({
    ua: navigator.userAgent,
    lang: navigator.language,
    langs: navigator.languages,
    platform: navigator.platform,
    timezone,
    screen: screenInfo,
    pixelRatio: safeNumber(window.devicePixelRatio),
    hardwareConcurrency: safeNumber(navigator.hardwareConcurrency),
    deviceMemory: safeNumber(deviceMemory),
    touchPoints: safeNumber(navigator.maxTouchPoints),
    canvas: getCanvasFingerprint(),
  });
};

const bufferToHex = (buffer: ArrayBuffer) => Array.from(new Uint8Array(buffer))
  .map((byte) => byte.toString(16).padStart(2, '0'))
  .join('');

const fallbackHash = (input: string) => {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return `fallback-${Math.abs(hash)}`;
};

const sha256 = async (input: string) => {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const data = new TextEncoder().encode(input);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return bufferToHex(digest);
  }
  return fallbackHash(input);
};

export const getBrowserFingerprint = async () => {
  if (fingerprintPromise) {
    return fingerprintPromise;
  }
  fingerprintPromise = (async () => {
    try {
      if (typeof localStorage !== 'undefined') {
        const cached = localStorage.getItem(STORAGE_KEY);
        if (cached) return cached;
      }
      const raw = buildFingerprintSource();
      const hashed = await sha256(raw);
      try {
        localStorage.setItem(STORAGE_KEY, hashed);
      } catch {
        // 本地存储不可用时只使用内存缓存
      }
      return hashed;
    } catch {
      return sha256(buildFingerprintSource());
    }
  })();
  return fingerprintPromise;
};
