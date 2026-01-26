import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, Smile } from 'lucide-react';

import { MEME_BASE_PATH, MEME_ITEMS, MEME_PACK } from './memeManifest';

type MemeItem = {
  file: string;
  label: string;
};

type MemeManifest = {
  pack: string;
  items: MemeItem[];
};

const DEFAULT_PACK = 'Default';
const DEFAULT_BASE_PATH = MEME_BASE_PATH;

const encodePathSegment = (value: string) => encodeURIComponent(value).replace(/%2F/g, '/');

const normalizeMemeShortcode = (label: string) => `[:${label}:]`;

const fetchManifest = async (): Promise<MemeManifest> => {
  return {
    pack: MEME_PACK || DEFAULT_PACK,
    items: Array.isArray(MEME_ITEMS) ? MEME_ITEMS : [],
  };
};

export const useMemeInsert = (value: string, setValue: (next: string) => void) => {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const insertMeme = (label: string) => {
    const textarea = textareaRef.current;
    const insert = `${normalizeMemeShortcode(label)} `;

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
  onSelect: (label: string) => void;
  placement?: 'up' | 'down';
}> = ({ open, onClose, onSelect, placement = 'up' }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [manifest, setManifest] = useState<MemeManifest | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

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
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    const handleClick = (event: MouseEvent) => {
      if (!panelRef.current) return;
      if (!panelRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleClick);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleClick);
    };
  }, [onClose, open]);

  const items = useMemo(() => manifest?.items || [], [manifest?.items]);

  if (!open) {
    return null;
  }

  const placementClass = placement === 'down'
    ? 'top-full mt-2'
    : 'bottom-full mb-2';

  return (
    <div
      ref={panelRef}
      className={`absolute right-0 ${placementClass} w-[min(420px,90vw)] bg-white border-2 border-ink rounded-xl shadow-sketch p-3 z-[60]`}
      role="dialog"
      aria-label="选择表情包"
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Smile className="w-4 h-4 text-pencil" />
          <span className="font-hand font-bold text-ink">表情包</span>
          <span className="text-xs text-pencil">{manifest?.pack || DEFAULT_PACK}</span>
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
        <div className="py-8 text-center text-sm text-pencil font-hand">加载中...</div>
      ) : error ? (
        <div className="py-6 text-center text-sm text-red-600 font-hand">{error}</div>
      ) : items.length === 0 ? (
        <div className="py-6 text-center text-sm text-pencil font-hand">暂无表情包</div>
      ) : (
        <div className="max-h-72 overflow-auto pr-1 grid grid-cols-8 gap-2">
          {items.map((item) => {
            const src = `${DEFAULT_BASE_PATH}/${encodePathSegment(item.file)}`;
            return (
              <button
                key={item.file}
                type="button"
                onClick={() => onSelect(item.label)}
                className="group flex items-center justify-center rounded-lg border border-gray-200 hover:border-ink hover:bg-highlight transition-colors p-1"
                title={item.label}
                aria-label={item.label}
              >
                <img
                  src={src}
                  alt={item.label}
                  loading="lazy"
                  decoding="async"
                  className="w-8 h-8 object-contain"
                />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default MemePicker;
