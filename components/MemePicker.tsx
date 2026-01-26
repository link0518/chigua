import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Smile } from 'lucide-react';

import { DEFAULT_MEME_PACK, MEME_PACKS, MEME_PACK_TO_ITEMS } from './memeManifest';

type MemeItem = {
  file: string;
  label: string;
};

type MemeManifest = {
  pack: string;
  items: MemeItem[];
};

const DEFAULT_BASE_PATH = '/meme';
const DEFAULT_PACK_DISPLAY_NAME = '默认';

const getPackDisplayName = (packName: string) => {
  return packName === DEFAULT_MEME_PACK ? DEFAULT_PACK_DISPLAY_NAME : packName;
};

const encodePathSegment = (value: string) => encodeURIComponent(value).replace(/%2F/g, '/');

const normalizeMemeShortcode = (label: string) => `[:${label}:]`;
const normalizeMemeShortcodeWithPack = (packName: string, label: string) => `[:${packName}/${label}:]`;

const fetchManifest = async (): Promise<MemeManifest> => {
  return { pack: DEFAULT_MEME_PACK, items: MEME_PACK_TO_ITEMS.get(DEFAULT_MEME_PACK) || [] };
};

export const useMemeInsert = (value: string, setValue: (next: string) => void) => {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const insertMeme = (packName: string, label: string) => {
    const textarea = textareaRef.current;
    const shortcode = packName === DEFAULT_MEME_PACK
      ? normalizeMemeShortcode(label)
      : normalizeMemeShortcodeWithPack(packName, label);
    const insert = `${shortcode} `;

    if (!textarea) {
      setValue(`${value}${value.endsWith('\n') || value === '' ? '' : '\n'}${insert}`);
      return;
    }

    const start = typeof textarea.selectionStart === 'number' ? textarea.selectionStart : value.length;
    const end = typeof textarea.selectionEnd === 'number' ? textarea.selectionEnd : start;
    const safeStart = Math.max(0, Math.min(start, value.length));
    const safeEnd = Math.max(safeStart, Math.min(end, value.length));
    const nextValue = `${value.slice(0, safeStart)}${insert}${value.slice(safeEnd)}`;
    const nextCursor = safeStart + insert.length;

    setValue(nextValue);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(nextCursor, nextCursor);
    });
  };

  return { textareaRef, insertMeme };
};

const MemePicker: React.FC<{
  open: boolean;
  onClose: () => void;
  onSelect: (packName: string, label: string) => void;
  placement?: 'up' | 'down';
  anchorRef?: React.RefObject<HTMLElement>;
}> = ({ open, onClose, onSelect, placement = 'up', anchorRef }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [manifest, setManifest] = useState<MemeManifest | null>(null);
  const [activePack, setActivePack] = useState<string>(DEFAULT_MEME_PACK);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [desktopLayout, setDesktopLayout] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(min-width: 640px)').matches;
  });
  const [desktopStyle, setDesktopStyle] = useState<React.CSSProperties>({});

  useEffect(() => {
    if (!open) {
      return;
    }
    setLoading(true);
    setError('');
    fetchManifest()
      .then((data) => setManifest(data))
      .catch((err) => {
        const message = err instanceof Error ? err.message : '表情包清单加载失败';
        setError(message);
        setManifest(null);
      })
      .finally(() => setLoading(false));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setActivePack(DEFAULT_MEME_PACK);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    const handleClickCapture = (event: MouseEvent) => {
      const anchor = anchorRef?.current;
      if (!panelRef.current) return;
      if (!panelRef.current.contains(event.target as Node)) {
        if (anchor && anchor.contains(event.target as Node)) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('click', handleClickCapture, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('click', handleClickCapture, true);
    };
  }, [anchorRef, onClose, open]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const media = window.matchMedia('(min-width: 640px)');
    const updateLayout = () => setDesktopLayout(media.matches);
    updateLayout();

    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', updateLayout);
      return () => media.removeEventListener('change', updateLayout);
    }

    // eslint-disable-next-line deprecation/deprecation
    media.addListener(updateLayout);
    // eslint-disable-next-line deprecation/deprecation
    return () => media.removeListener(updateLayout);
  }, []);

  useEffect(() => {
    if (!open) return;
    if (typeof window === 'undefined') return;

    const updatePosition = () => {
      if (!desktopLayout) {
        setDesktopStyle({});
        return;
      }

      const width = 420;
      const height = 360;
      const margin = 12;

      const anchorEl = anchorRef?.current;
      const rect = anchorEl?.getBoundingClientRect?.();
      if (!rect) {
        setDesktopStyle({
          left: `${margin}px`,
          top: `${margin}px`,
          width: `${Math.min(width, window.innerWidth - margin * 2)}px`,
          height: `${Math.min(height, window.innerHeight - margin * 2)}px`,
        });
        return;
      }

      const maxLeft = Math.max(margin, window.innerWidth - width - margin);
      const nextLeft = Math.min(maxLeft, Math.max(margin, rect.right - width));

      const preferDown = placement === 'down';
      const downTop = rect.bottom + margin;
      const upTop = rect.top - height - margin;

      let nextTop = preferDown ? downTop : upTop;
      const wouldOverflowBottom = nextTop + height > window.innerHeight - margin;
      const wouldOverflowTop = nextTop < margin;
      if (wouldOverflowBottom || wouldOverflowTop) {
        const flipped = preferDown ? upTop : downTop;
        if (flipped >= margin && flipped + height <= window.innerHeight - margin) {
          nextTop = flipped;
        } else {
          nextTop = Math.min(window.innerHeight - height - margin, Math.max(margin, nextTop));
        }
      }

      setDesktopStyle({
        left: `${nextLeft}px`,
        top: `${nextTop}px`,
        width: `${width}px`,
        height: `${height}px`,
      });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [anchorRef, desktopLayout, open, placement]);

  const packNames = useMemo(() => MEME_PACKS.map((pack) => pack.name), []);
  const items = useMemo(() => MEME_PACK_TO_ITEMS.get(activePack) || [], [activePack]);
  const activePackDisplayName = useMemo(() => getPackDisplayName(activePack), [activePack]);

  if (!open) {
    return null;
  }

  const panel = (
    <div
      ref={panelRef}
      className={desktopLayout
        ? 'fixed bg-white border-2 border-ink rounded-xl shadow-sketch p-3 z-[60] flex flex-col'
        : 'fixed inset-x-0 bottom-0 mx-auto w-full max-w-full bg-white border-2 border-ink shadow-sketch p-3 z-[60] rounded-t-xl flex flex-col h-[min(60vh,420px)]'}
      style={desktopLayout ? desktopStyle : undefined}
      role="dialog"
      aria-label="选择表情包"
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Smile className="w-4 h-4 text-pencil" />
          <span className="font-hand font-bold text-ink">表情包</span>
          <span className="text-xs text-pencil">{activePackDisplayName}</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded-md border border-gray-200 hover:border-ink hover:bg-highlight transition-colors"
          aria-label="关闭表情包"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {loading ? (
        <div className="flex-1 min-h-0 flex items-center justify-center text-center text-sm text-pencil font-hand">加载中...</div>
      ) : error ? (
        <div className="flex-1 min-h-0 flex items-center justify-center text-center text-sm text-red-600 font-hand">{error}</div>
      ) : items.length === 0 ? (
        <div className="flex-1 min-h-0 flex items-center justify-center text-center text-sm text-pencil font-hand">暂无表情包</div>
      ) : (
        <div className="flex flex-1 min-h-0 gap-3">
          <div className="w-24 shrink-0 h-full overflow-auto pr-1 border-r border-gray-200">
            <div className="flex flex-col gap-1">
              {packNames.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => setActivePack(name)}
                  className={`text-left px-2 py-1 rounded-md border transition-colors font-hand text-sm ${activePack === name ? 'border-ink bg-highlight text-ink' : 'border-transparent hover:border-gray-200 hover:bg-gray-50 text-pencil'}`}
                  title={getPackDisplayName(name)}
                >
                  {getPackDisplayName(name)}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-auto pr-1">
            <div className="grid grid-cols-6 sm:grid-cols-8 gap-2 content-start auto-rows-max">
              {items.map((item) => {
                const src = `${DEFAULT_BASE_PATH}/${encodePathSegment(activePack)}/${encodePathSegment(item.file)}`;
                return (
                  <button
                    key={`${activePack}:${item.file}`}
                    type="button"
                    onClick={() => onSelect(activePack, item.label)}
                    className="group relative w-full h-0 pb-[100%] rounded-lg border border-gray-200 hover:border-ink hover:bg-highlight transition-colors overflow-hidden"
                    title={item.label}
                    aria-label={item.label}
                  >
                    <img
                      src={src}
                      alt={item.label}
                      loading="lazy"
                      decoding="async"
                      className="absolute inset-0 w-full h-full p-1 object-contain"
                    />
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );

  if (typeof document === 'undefined') {
    return panel;
  }

  return createPortal(panel, document.body);
};

export default MemePicker;
