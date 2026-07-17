import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Smile } from 'lucide-react';

import { DEFAULT_MEME_PACK, MEME_PACKS, MEME_PACK_TO_ITEMS } from './memeManifest';
import MobileBottomSheet from './MobileBottomSheet';

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
    return window.matchMedia('(min-width: 768px)').matches;
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
    if (!open || !desktopLayout) return;
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
  }, [anchorRef, desktopLayout, onClose, open]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const media = window.matchMedia('(min-width: 768px)');
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

  const pickerBody = loading ? (
    <div className="flex flex-1 min-h-0 items-center justify-center text-center text-sm text-pencil font-hand">加载中...</div>
  ) : error ? (
    <div className="flex flex-1 min-h-0 items-center justify-center text-center text-sm text-red-600 font-hand">{error}</div>
  ) : items.length === 0 ? (
    <div className="flex flex-1 min-h-0 items-center justify-center text-center text-sm text-pencil font-hand">暂无表情包</div>
  ) : (
    <div className="flex flex-1 min-h-0 gap-3">
      <div className="h-full w-20 shrink-0 overflow-auto border-r border-gray-200 pr-1 md:w-24">
        <div className="flex flex-col gap-1">
          {packNames.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => setActivePack(name)}
              className={`min-h-11 rounded-md border px-2 py-2 text-left font-hand text-sm transition-colors md:min-h-0 md:py-1 ${activePack === name ? 'border-ink bg-highlight text-ink' : 'border-transparent text-pencil hover:border-gray-200 hover:bg-gray-50'}`}
              title={getPackDisplayName(name)}
            >
              {getPackDisplayName(name)}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto pr-1">
        <div className="grid auto-rows-max grid-cols-6 content-start gap-2 sm:grid-cols-8">
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
  );

  const desktopPanel = (
    <div
      ref={panelRef}
      className="fixed z-[90] flex flex-col rounded-xl border-2 border-ink bg-white p-3 shadow-sketch"
      style={desktopStyle}
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
          className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-gray-200 transition-colors hover:border-ink hover:bg-highlight md:h-8 md:w-8"
          aria-label="关闭表情包"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {pickerBody}
    </div>
  );

  if (typeof document === 'undefined') {
    return desktopPanel;
  }

  if (!desktopLayout) {
    return (
      <MobileBottomSheet
        isOpen
        onClose={onClose}
        title={(
          <span className="flex min-w-0 items-center gap-2">
            <Smile className="h-4 w-4 shrink-0 text-pencil" aria-hidden="true" />
            <span>表情包</span>
            <span className="truncate text-xs font-normal text-pencil">{activePackDisplayName}</span>
          </span>
        )}
        closeButtonAriaLabel="关闭表情包"
        returnFocusRef={anchorRef as React.RefObject<HTMLElement | null> | undefined}
        className="rounded-t-xl"
        overlayClassName="z-[90]"
        contentClassName="overflow-hidden"
        panelStyle={{
          height: 'min(60dvh, 420px)',
          maxHeight: 'calc(100dvh - max(8px, env(safe-area-inset-top, 0px)))',
        }}
      >
        <div className="flex h-full min-h-0 flex-col p-3">
          {pickerBody}
        </div>
      </MobileBottomSheet>
    );
  }

  return createPortal(desktopPanel, document.body);
};

export default MemePicker;
