import React, { useCallback, useImperativeHandle, useMemo, useRef } from 'react';
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { EditorSelection, Prec } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { markdown, markdownKeymap, pasteURLAsLink } from '@codemirror/lang-markdown';

export type MarkdownEditorCommand =
  | 'heading'
  | 'bold'
  | 'italic'
  | 'quote'
  | 'bulletList'
  | 'orderedList'
  | 'code'
  | 'link';

export interface MarkdownEditorHandle {
  focus: () => void;
  runCommand: (command: MarkdownEditorCommand) => boolean;
  insertText: (text: string) => boolean;
}

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  minHeight?: string;
  autoFocus?: boolean;
  ariaLabel?: string;
  onPasteImage?: (file: File) => void;
  themeOptions?: MarkdownEditorThemeOptions;
}

export interface MarkdownEditorThemeOptions {
  fontFamily?: string;
  fontSize?: string;
  lineHeight?: string;
  padding?: string;
  textColor?: string;
  cursorColor?: string;
  placeholderColor?: string;
  selectionColor?: string;
  focusedSelectionColor?: string;
}

type TransformInput = {
  selectedText: string;
  hasSelection: boolean;
};

type TransformOutput = {
  insertText: string;
  selectionStart: number;
  selectionEnd: number;
};

const DEFAULT_THEME_OPTIONS: Required<MarkdownEditorThemeOptions> = {
  fontFamily: '"Noto Sans SC", sans-serif',
  fontSize: '1.25rem',
  lineHeight: '2rem',
  padding: '16px',
  textColor: '#2c2c2c',
  cursorColor: '#2c2c2c',
  placeholderColor: 'rgba(85, 85, 85, 0.45)',
  selectionColor: 'rgba(255, 245, 157, 0.45)',
  focusedSelectionColor: 'rgba(255, 245, 157, 0.55)',
};

const createEditorTheme = (themeOptions?: MarkdownEditorThemeOptions) => {
  const resolved = {
    ...DEFAULT_THEME_OPTIONS,
    ...(themeOptions || {}),
  };

  return EditorView.theme({
    '&': {
      height: '100%',
      backgroundColor: 'transparent',
      color: resolved.textColor,
      fontFamily: resolved.fontFamily,
    },
    '&.cm-focused': {
      outline: 'none',
    },
    '.cm-scroller': {
      overflow: 'auto',
      fontFamily: 'inherit',
    },
    '.cm-content': {
      padding: resolved.padding,
      fontFamily: 'inherit',
      fontSize: resolved.fontSize,
      lineHeight: resolved.lineHeight,
      caretColor: resolved.cursorColor,
    },
    '.cm-line': {
      padding: '0',
    },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: resolved.cursorColor,
    },
    '.cm-selectionBackground': {
      backgroundColor: resolved.selectionColor,
    },
    '&.cm-focused .cm-selectionBackground': {
      backgroundColor: resolved.focusedSelectionColor,
    },
    '.cm-placeholder': {
      color: resolved.placeholderColor,
    },
  });
};

const basicSetup = {
  lineNumbers: false,
  highlightActiveLineGutter: false,
  foldGutter: false,
  dropCursor: false,
  allowMultipleSelections: false,
  indentOnInput: false,
  bracketMatching: false,
  closeBrackets: false,
  autocompletion: false,
  rectangularSelection: false,
  crosshairCursor: false,
  highlightActiveLine: false,
  highlightSelectionMatches: false,
  closeBracketsKeymap: false,
  searchKeymap: false,
  foldKeymap: false,
  completionKeymap: false,
  lintKeymap: false,
  tabSize: 2,
} as const;

const applySelectionTransform = (
  view: EditorView,
  transform: (input: TransformInput) => TransformOutput
) => {
  const transaction = view.state.changeByRange((range) => {
    const selectedText = view.state.sliceDoc(range.from, range.to);
    const result = transform({
      selectedText,
      hasSelection: range.from !== range.to,
    });

    return {
      changes: {
        from: range.from,
        to: range.to,
        insert: result.insertText,
      },
      range: EditorSelection.range(
        range.from + result.selectionStart,
        range.from + result.selectionEnd
      ),
    };
  });

  view.dispatch(transaction, {
    scrollIntoView: true,
    userEvent: 'input',
  });
  view.focus();
  return true;
};

const wrapSelections = (
  view: EditorView,
  prefix: string,
  suffix: string,
  placeholder: string
) => {
  return applySelectionTransform(view, ({ selectedText, hasSelection }) => {
    const content = hasSelection ? selectedText : placeholder;
    const insertText = `${prefix}${content}${suffix}`;

    if (hasSelection) {
      const cursor = insertText.length;
      return {
        insertText,
        selectionStart: cursor,
        selectionEnd: cursor,
      };
    }

    return {
      insertText,
      selectionStart: prefix.length,
      selectionEnd: prefix.length + content.length,
    };
  });
};

const prefixSelections = (
  view: EditorView,
  placeholder: string,
  formatter: (line: string, index: number) => string
) => {
  const transaction = view.state.changeByRange((range) => {
    if (range.from === range.to) {
      const line = view.state.doc.lineAt(range.from);
      const isBlankLine = line.text.trim().length === 0;

      if (isBlankLine) {
        const insertText = formatter(placeholder, 0);
        const markerIndex = insertText.indexOf(placeholder);
        const start = markerIndex >= 0 ? markerIndex : insertText.length;
        return {
          changes: {
            from: line.from,
            to: line.to,
            insert: insertText,
          },
          range: EditorSelection.range(
            line.from + start,
            line.from + start + placeholder.length
          ),
        };
      }

      const insertText = formatter(line.text, 0);
      const prefixLength = formatter('', 0).length;
      const cursorOffset = range.from - line.from + prefixLength;
      return {
        changes: {
          from: line.from,
          to: line.to,
          insert: insertText,
        },
        range: EditorSelection.cursor(line.from + cursorOffset),
      };
    }

    const firstLine = view.state.doc.lineAt(range.from);
    const lastLine = view.state.doc.lineAt(Math.max(range.from, range.to - 1));
    const insertText = view.state.sliceDoc(firstLine.from, lastLine.to)
      .split('\n')
      .map((line, index) => formatter(line, index))
      .join('\n');

    return {
      changes: {
        from: firstLine.from,
        to: lastLine.to,
        insert: insertText,
      },
      range: EditorSelection.range(firstLine.from, firstLine.from + insertText.length),
    };
  });

  view.dispatch(transaction, {
    scrollIntoView: true,
    userEvent: 'input',
  });
  view.focus();
  return true;
};

const insertLink = (view: EditorView) => {
  return applySelectionTransform(view, ({ selectedText }) => {
    const label = selectedText || '链接文本';
    const url = 'https://';
    const insertText = `[${label}](${url})`;
    const urlStart = label.length + 3;
    return {
      insertText,
      selectionStart: urlStart,
      selectionEnd: urlStart + url.length,
    };
  });
};

const insertTextAtSelection = (view: EditorView, text: string) => {
  return applySelectionTransform(view, () => ({
    insertText: text,
    selectionStart: text.length,
    selectionEnd: text.length,
  }));
};

const runEditorCommand = (view: EditorView, command: MarkdownEditorCommand) => {
  switch (command) {
    case 'heading':
      return prefixSelections(view, '标题', (line) => `## ${line}`);
    case 'bold':
      return wrapSelections(view, '**', '**', '粗体内容');
    case 'italic':
      return wrapSelections(view, '*', '*', '斜体内容');
    case 'quote':
      return prefixSelections(view, '引用内容', (line) => `> ${line}`);
    case 'bulletList':
      return prefixSelections(view, '列表项', (line) => `- ${line}`);
    case 'orderedList':
      return prefixSelections(view, '列表项', (line, index) => `${index + 1}. ${line}`);
    case 'code':
      return wrapSelections(view, '`', '`', '代码');
    case 'link':
      return insertLink(view);
    default:
      return false;
  }
};

const MarkdownEditor = React.forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(({
  value,
  onChange,
  placeholder,
  minHeight = '300px',
  autoFocus = false,
  ariaLabel = 'Markdown 编辑器',
  onPasteImage,
  themeOptions,
}, ref) => {
  const editorRef = useRef<ReactCodeMirrorRef | null>(null);
  const onPasteImageRef = useRef(onPasteImage);
  onPasteImageRef.current = onPasteImage;

  const pasteImageHandler = useCallback(() => {
    return EditorView.domEventHandlers({
      paste(event) {
        const cb = onPasteImageRef.current;
        if (!cb) return false;
        const items = event.clipboardData?.items;
        if (!items) return false;
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (item.kind === 'file' && item.type.startsWith('image/')) {
            const file = item.getAsFile();
            if (file) {
              event.preventDefault();
              cb(file);
              return true;
            }
          }
        }
        return false;
      },
    });
  }, []);

  const extensions = useMemo(() => ([
    markdown(),
    pasteURLAsLink,
    EditorView.lineWrapping,
    EditorView.contentAttributes.of({
      spellcheck: 'false',
      autocorrect: 'off',
      autocapitalize: 'off',
      'aria-label': ariaLabel,
    }),
    Prec.high(
      keymap.of([
        ...markdownKeymap,
        { key: 'Mod-b', run: (view) => runEditorCommand(view, 'bold') },
        { key: 'Mod-i', run: (view) => runEditorCommand(view, 'italic') },
        { key: 'Mod-k', run: (view) => runEditorCommand(view, 'link') },
      ])
    ),
    pasteImageHandler(),
    createEditorTheme(themeOptions),
  ]), [ariaLabel, pasteImageHandler, themeOptions]);

  useImperativeHandle(ref, () => ({
    focus: () => {
      editorRef.current?.view?.focus();
    },
    runCommand: (command) => {
      const view = editorRef.current?.view;
      if (!view) {
        return false;
      }
      return runEditorCommand(view, command);
    },
    insertText: (text) => {
      const view = editorRef.current?.view;
      if (!view) {
        return false;
      }
      return insertTextAtSelection(view, text);
    },
  }), []);

  return (
    <CodeMirror
      ref={editorRef}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      theme="none"
      basicSetup={basicSetup}
      extensions={extensions}
      autoFocus={autoFocus}
      minHeight={minHeight}
      height="100%"
      indentWithTab
      className="h-full"
    />
  );
});

MarkdownEditor.displayName = 'MarkdownEditor';

export default MarkdownEditor;
