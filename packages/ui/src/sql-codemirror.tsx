import {SQLite, sql} from '@codemirror/lang-sql';
import type {SQLNamespace} from '@codemirror/lang-sql';
import {javascript} from '@codemirror/lang-javascript';
import {yaml} from '@codemirror/lang-yaml';
import {EditorState, type Extension, Prec} from '@codemirror/state';
import {lintGutter, linter} from '@codemirror/lint';
import {EditorView, keymap} from '@codemirror/view';
import {acceptCompletion, autocompletion} from '@codemirror/autocomplete';
import CodeMirror from '@uiw/react-codemirror';
import CodeMirrorMerge from 'react-codemirror-merge';

import type {SqlEditorDiagnostic, StudioRelation} from './shared.js';

const Original = CodeMirrorMerge.Original;
const Modified = CodeMirrorMerge.Modified;

export function SqlCodeMirror(input: {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  relations: readonly StudioRelation[];
  diagnostics?: readonly SqlEditorDiagnostic[];
  onExecute?: (sql: string) => void;
  readOnly?: boolean;
}) {
  const schema = buildSqlSchema(input.relations);
  const executeKeymapHandler = (view: EditorView) => {
    input.onExecute?.(view.state.doc.toString());
    return true;
  };
  const extensions: Extension[] = [
    sql({
      dialect: SQLite,
      schema,
    }),
    autocompletion({
      interactionDelay: 0,
    }),
    linter(() =>
      (input.diagnostics ?? []).map((diagnostic) => ({
        from: diagnostic.from,
        to: diagnostic.to,
        message: diagnostic.message,
        severity: 'error' as const,
      })),
    ),
    lintGutter(),
    EditorView.lineWrapping,
    EditorState.readOnly.of(Boolean(input.readOnly)),
    EditorView.editable.of(!input.readOnly),
    Prec.highest(
      keymap.of([
        {
          key: 'Cmd-Enter',
          run: executeKeymapHandler,
        },
        {
          win: 'Ctrl-Enter',
          run: executeKeymapHandler,
        },
        {
          key: 'Tab',
          run: (view) => acceptCompletion(view),
        },
      ]),
    ),
  ];

  return (
    <CodeMirror
      value={input.value}
      height="16rem"
      aria-label={input.ariaLabel}
      theme="dark"
      extensions={extensions}
      basicSetup={{
        foldGutter: false,
      }}
      onChange={input.onChange}
    />
  );
}

export function TextCodeMirror(input: {
  value: string;
  ariaLabel: string;
  readOnly?: boolean;
  height?: string;
  language?: 'plain' | 'yaml' | 'markdown' | 'typescript';
  onChange?: (value: string) => void;
}) {
  return (
    <CodeMirror
      value={input.value}
      height={input.height ?? '16rem'}
      aria-label={input.ariaLabel}
      theme="dark"
      extensions={buildTextExtensions(Boolean(input.readOnly), input.language ?? 'plain')}
      basicSetup={{
        foldGutter: false,
      }}
      onChange={(value) => input.onChange?.(value)}
    />
  );
}

export function TextDiffCodeMirror(input: {original: string; draft: string; ariaLabel: string}) {
  return (
    <div aria-label={input.ariaLabel}>
      <CodeMirrorMerge
        orientation="a-b"
        theme="dark"
        className="text-diff-editor"
        collapseUnchanged={{
          margin: 1,
          minSize: 4,
        }}
      >
        <Original value={input.original} extensions={buildTextExtensions(true, 'plain')} />
        <Modified value={input.draft} extensions={buildTextExtensions(true, 'plain')} />
      </CodeMirrorMerge>
    </div>
  );
}

function buildSqlSchema(relations: readonly StudioRelation[]): SQLNamespace {
  return Object.fromEntries(
    relations.map((relation) => [
      relation.name,
      relation.columns.map((column) => ({
        label: column.name,
        type: 'property' as const,
        detail: column.type || 'untyped',
      })),
    ]),
  );
}

function buildTextExtensions(readOnly: boolean, language: 'plain' | 'yaml' | 'markdown' | 'typescript'): Extension[] {
  return [
    ...(language === 'yaml' ? [yaml()] : []),
    ...(language === 'typescript' ? [javascript({typescript: true})] : []),
    EditorView.lineWrapping,
    EditorState.readOnly.of(readOnly),
    EditorView.editable.of(!readOnly),
  ];
}
