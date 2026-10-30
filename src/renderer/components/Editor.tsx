import { useEffect, useRef } from 'react';
import { Compartment, EditorSelection, EditorState, StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, keymap, type DecorationSet } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';

export interface Highlight {
  id: string;
  start: number;
  end: number;
  title: string;
  active: boolean;
}

const setHighlights = StateEffect.define<Highlight[]>();

const highlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setHighlights)) {
        const len = tr.state.doc.length;
        const ranges = e.value
          .filter((h) => h.start < h.end && h.end <= len)
          .sort((a, b) => a.start - b.start)
          .map((h) => Decoration.mark({ class: h.active ? 'cm-comment cm-comment-active' : 'cm-comment', attributes: { title: h.title } }).range(h.start, h.end));
        deco = Decoration.set(ranges, true);
      }
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

export interface EditorHandle {
  select(start: number, end: number): void;
  focus(): void;
}

interface Props {
  value: string;
  readOnly: boolean;
  highlights: Highlight[];
  onChange(text: string): void;
  onSelection(sel: { start: number; end: number; text: string } | null): void;
  handleRef?: React.MutableRefObject<EditorHandle | null>;
  testId?: string;
}

export function Editor({ value, readOnly, highlights, onChange, onSelection, handleRef, testId }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const ro = useRef(new Compartment());
  const cbs = useRef({ onChange, onSelection });
  cbs.current = { onChange, onSelection };
  // True while the document is replaced from props (loading a version), so it is not reported as a user edit.
  const external = useRef(false);

  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          markdown(),
          EditorView.lineWrapping,
          highlightField,
          ro.current.of([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]),
          EditorView.updateListener.of((u) => {
            if (u.docChanged && !external.current) cbs.current.onChange(u.state.doc.toString());
            if (u.selectionSet || u.docChanged) {
              const r = u.state.selection.main;
              cbs.current.onSelection(r.empty ? null : { start: r.from, end: r.to, text: u.state.sliceDoc(r.from, r.to) });
            }
          }),
        ],
      }),
    });
    view.current = v;
    if (handleRef)
      handleRef.current = {
        select(start, end) {
          v.dispatch({ selection: EditorSelection.single(start, end), scrollIntoView: true });
          v.focus();
        },
        focus: () => v.focus(),
      };
    return () => {
      v.destroy();
      view.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value) {
      external.current = true;
      try {
        v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
      } finally {
        external.current = false;
      }
    }
  }, [value]);

  useEffect(() => {
    view.current?.dispatch({ effects: ro.current.reconfigure([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]) });
  }, [readOnly]);

  useEffect(() => {
    view.current?.dispatch({ effects: setHighlights.of(highlights) });
  }, [highlights]);

  return <div className={`editor ${readOnly ? 'readonly' : ''}`} ref={host} data-testid={testId} />;
}
