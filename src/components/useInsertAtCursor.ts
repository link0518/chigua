import React, { useCallback } from 'react';

export const useInsertAtCursor = (
  value: string,
  setValue: React.Dispatch<React.SetStateAction<string>>,
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
) => {
  const insertAtCursor = useCallback((insert: string) => {
    const textarea = textareaRef.current;

    const selectionStart = typeof textarea?.selectionStart === 'number' ? textarea.selectionStart : null;
    const selectionEnd = typeof textarea?.selectionEnd === 'number' ? textarea.selectionEnd : null;
    const cursorFallback = typeof selectionStart === 'number' ? selectionStart : null;

    setValue((prev) => {
      const current = typeof textarea?.value === 'string' ? textarea.value : prev;
      const start = typeof selectionStart === 'number' ? selectionStart : (cursorFallback ?? current.length);
      const end = typeof selectionEnd === 'number' ? selectionEnd : start;
      const safeStart = Math.max(0, Math.min(start, current.length));
      const safeEnd = Math.max(safeStart, Math.min(end, current.length));
      return `${current.slice(0, safeStart)}${insert}${current.slice(safeEnd)}`;
    });

    requestAnimationFrame(() => {
      const next = textareaRef.current;
      if (!next) {
        return;
      }
      const start = typeof next.selectionStart === 'number' ? next.selectionStart : next.value.length;
      const nextCursor = start + insert.length;
      next.focus();
      next.setSelectionRange(nextCursor, nextCursor);
    });
  }, [setValue, textareaRef, value]);

  return { insertAtCursor };
};
