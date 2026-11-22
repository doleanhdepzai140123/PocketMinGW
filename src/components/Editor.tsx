import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLineGutter, highlightSpecialChars, drawSelection, highlightActiveLine, rectangularSelection } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab, undo, redo, undoDepth, redoDepth } from '@codemirror/commands';
import { cpp } from '@codemirror/lang-cpp';
import { bracketMatching, foldGutter, indentOnInput, syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { searchKeymap, highlightSelectionMatches, openSearchPanel } from '@codemirror/search';
import type { SourceFile } from '../core/model';

export interface EditorHandle { insert(text: string): void; undo(): void; redo(): void; search(): void; goto(line: number, column: number): void }
interface Props { file: SourceFile; fontSize: number; wrap: boolean; onChange(content: string): void; onCursor(line: number, column: number): void; onHistory(undo: boolean, redo: boolean): void }
const highlights = HighlightStyle.define([
  { tag: [tags.keyword, tags.modifier], color: 'var(--syntax-keyword)' },
  { tag: [tags.string, tags.character], color: 'var(--syntax-string)' },
  { tag: [tags.number, tags.bool], color: 'var(--syntax-number)' },
  { tag: tags.comment, color: 'var(--color-muted)' },
  { tag: [tags.typeName, tags.className], color: 'var(--syntax-type)' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: 'var(--syntax-function)' },
  { tag: tags.meta, color: 'var(--syntax-meta)' },
]);
export const CodeEditor = forwardRef<EditorHandle, Props>((props, ref) => {
  const host = useRef<HTMLDivElement>(null), view = useRef<EditorView | null>(null), current = useRef(props);
  const states = useRef(new Map<string, EditorState>()), path = useRef(props.file.path), wrap = useRef(new Compartment());
  const factory = useRef<(content: string) => EditorState>(() => EditorState.create());
  const syncing = useRef(false);
  current.current = props;
  useEffect(() => {
    if (!host.current) return;
    const create = (content: string) => EditorState.create({ doc: content, extensions: [
      lineNumbers(), highlightActiveLineGutter(), highlightSpecialChars(), history(), foldGutter(), drawSelection(), indentOnInput(), bracketMatching(), closeBrackets(), rectangularSelection(), highlightActiveLine(), highlightSelectionMatches(), cpp(), syntaxHighlighting(highlights), autocompletion(),
      keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...searchKeymap, ...completionKeymap, indentWithTab]),
      EditorView.contentAttributes.of({ 'aria-label': 'Mã nguồn C++', autocorrect: 'off', autocapitalize: 'off', spellcheck: 'false' }),
      wrap.current.of(current.current.wrap ? EditorView.lineWrapping : []),
      EditorView.updateListener.of(u => {
        current.current.onHistory(undoDepth(u.state)>0, redoDepth(u.state)>0);
        if (u.docChanged && !syncing.current) current.current.onChange(u.state.doc.toString());
        if (u.selectionSet || u.docChanged) { const at = u.state.selection.main.head, line = u.state.doc.lineAt(at); current.current.onCursor(line.number, at - line.from + 1); }
      }),
    ] });
    factory.current = create;
    const v = new EditorView({ state: create(current.current.file.content), parent: host.current }); view.current = v;
    return () => { v.destroy(); view.current = null; };
  }, []);
  useEffect(() => {
    const v = view.current; if (!v) return;
    if (path.current !== props.file.path) {
      states.current.set(path.current, v.state);
      const saved = states.current.get(props.file.path);
      v.setState(saved ?? factory.current(props.file.content));
      path.current = props.file.path;
      if (!saved) states.current.set(props.file.path, v.state);
    }
    syncing.current = true;
    if (v.state.doc.toString() !== props.file.content) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: props.file.content } });
    syncing.current = false;
    v.dispatch({ effects: wrap.current.reconfigure(props.wrap ? EditorView.lineWrapping : []) });
  }, [props.file.path, props.file.content, props.wrap]);
  useImperativeHandle(ref, () => ({
    insert(text) { const v=view.current;if(v){v.dispatch(v.state.replaceSelection(text));v.focus();} },
    undo() { if(view.current)undo(view.current); }, redo() { if(view.current)redo(view.current); }, search() { if(view.current)openSearchPanel(view.current); },
    goto(line,column) { const v=view.current;if(!v)return;const l=v.state.doc.line(Math.max(1,Math.min(v.state.doc.lines,line)));v.dispatch({selection:{anchor:Math.min(l.to,l.from+Math.max(0,column-1))},scrollIntoView:true});v.focus(); },
  }), []);
  return <div ref={host} className="code-editor" style={{ fontSize: Math.max(16, props.fontSize) }} />;
});
