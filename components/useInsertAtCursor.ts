import { useCallback } from 'react';

export const useInsertAtCursor = (
  value: string,
  setValue: (next: string) => void,
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
) => {
  const insertAtCursor = useCallback((insert: string) => {
    const textarea = textareaRef.current;

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
  }, [setValue, textareaRef, value]);

  return { insertAtCursor };
};

