import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { EditorState } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView, keymap } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { useEffect, useRef } from 'react';
import type { CodeLanguage } from '../../../shared/types.ts';

interface Props {
  /** Changing this replaces the document, e.g. when the next problem arrives. */
  documentKey: string;
  initialValue: string;
  /** `plain` for files that are not code, such as a brief or a data file. */
  language: CodeLanguage | 'plain';
  onChange: (value: string) => void;
  /** Ctrl or ⌘ + Enter. */
  onRun: () => void;
  /** Ctrl or ⌘ + S, when the document can be saved. */
  onSave?: () => void;
  label: string;
}

function languageSupport(language: CodeLanguage | 'plain') {
  if (language === 'plain') return [];
  if (language === 'python') return python();
  return javascript({ typescript: language === 'typescript' });
}

export function CodeEditor({ documentKey, initialValue, language, onChange, onRun, onSave, label }: Props) {
  const host = useRef<HTMLDivElement>(null);
  // The editor is created once per document; these keep its callbacks current.
  const latest = useRef({ onChange, onRun, onSave });
  latest.current = { onChange, onRun, onSave };

  useEffect(() => {
    if (!host.current) return;
    const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: initialValue,
        extensions: [
          keymap.of([
            { key: 'Mod-Enter', run: () => (latest.current.onRun(), true) },
            // Always handled, so the browser's own "save page" dialog never opens over the editor.
            { key: 'Mod-s', run: () => (latest.current.onSave?.(), true) },
          ]),
          basicSetup,
          languageSupport(language),
          ...(dark ? [oneDark] : []),
          EditorView.contentAttributes.of({ 'aria-label': label }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) latest.current.onChange(update.state.doc.toString());
          }),
        ],
      }),
    });
    return () => view.destroy();
    // The initial value belongs to the document key; later values come from typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentKey, language]);

  return <div ref={host} className="editor" />;
}
