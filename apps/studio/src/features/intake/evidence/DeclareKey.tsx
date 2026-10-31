import { useId, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button } from '@ulpin/ui';
import { fieldWords, type IntakeItem } from '../batch-model';
import { TableRefusal } from '../table/Progress';
import { DisabledReason } from '../DisabledReason';
import { focusSection } from '../StepStrip';
import { createDeclaration } from './api';
import { blankDeclaration, keyPaths, profileInput, type Declaration, type KeyProfile, type TableChoice } from './model';
import batch from '../Batch.module.css';
import styles from './Evidence.module.css';

export interface DeclareChoices { anchors: IntakeItem[]; tables: TableChoice[]; documents: IntakeItem[] }
type Change = (patch: Partial<Declaration>) => void;

/** D1. The officer names a key: its namespace in their words, the map field and the table columns or documents. */
export function DeclareKey({ caseId, choices, initial, done, cancel }: {
  caseId: string; choices: DeclareChoices; initial?: Declaration;
  done: (profile: KeyProfile) => void; cancel: () => void;
}) {
  const [declaration, setDeclaration] = useState(initial ?? blankDeclaration);
  const [send] = useState(() => createDeclaration(caseId));
  const press = useMutation({ mutationFn: send, onSuccess: done });
  const [missing, setMissing] = useState<string | null>(null);
  const submit = () => {
    const input = profileInput(declaration, choices.tables);
    setMissing(typeof input === 'string' ? input : null);
    if (typeof input !== 'string') press.mutate(input);
  };
  return <DeclareKeyForm choices={choices} declaration={declaration} pending={press.isPending}
    change={(patch) => setDeclaration((value) => ({ ...value, ...patch }))} submit={submit} cancel={cancel}
    missing={missing} error={press.error} />;
}

export function DeclareKeyForm({ choices, declaration, change, pending, submit, cancel, missing, error }: {
  choices: DeclareChoices; declaration: Declaration; change: Change; pending: boolean; submit: () => void;
  cancel: () => void; missing: string | null; error: Error | null;
}) {
  return <form className={batch.stack} aria-label="Link a register by a key" onSubmit={(event) => {
    event.preventDefault();
    submit();
  }}>
    <fieldset className={batch.fieldset} disabled={pending}>
      <div className={styles.fields}>
        <KeyFields declaration={declaration} change={change} />
        <AnchorFields anchors={choices.anchors} declaration={declaration} change={change} />
      </div>
      <TableFields tables={choices.tables} declaration={declaration} change={change} />
      <DocumentFields documents={choices.documents} declaration={declaration} change={change} />
    </fieldset>
    <span className="ul-row">
      <Button type="submit" variant="primary" disabled={pending}>Declare the key</Button>
      <Button variant="ghost" disabled={pending} onClick={cancel}>Cancel</Button>
    </span>
    {pending ? <p role="status">Declaring the key…</p> : null}
    {missing ? <p className="ul-error" role="alert">{missing}</p> : null}
    {error ? <TableRefusal error={error} /> : null}
  </form>;
}

function KeyFields({ declaration, change }: { declaration: Declaration; change: Change }) {
  return <>
    <label className="ul-field">
      <span className="ul-label">Key namespace, in your words</span>
      <input className="ul-input" value={declaration.namespace} maxLength={150} required
        onChange={(event) => change({ namespace: event.target.value })} />
    </label>
    <label className="ul-field">
      <span className="ul-label">Key kind</span>
      <select className="ul-input" value={declaration.kind}
        onChange={(event) => change({ kind: event.target.value as Declaration['kind'] })}>
        <option value="text">Text</option>
        <option value="integer">Whole number</option>
      </select>
    </label>
  </>;
}

function AnchorFields({ anchors, declaration, change }: {
  anchors: IntakeItem[]; declaration: Declaration; change: Change;
}) {
  const reasonId = useId();
  const anchorId = useId();
  const paths = keyPaths(anchors.find((item) => item.itemId === declaration.anchorItemId));
  const canChoose = !declaration.anchorItemId || anchors.some(item => keyPaths(item).length > 0);
  return <>
    <label className="ul-field">
      <span className="ul-label">Map item with drafted buildings</span>
      <select id={anchorId} className="ul-input" value={declaration.anchorItemId} required
        onChange={(event) => change({ anchorItemId: event.target.value, sourcePath: '' })}>
        <option value="">Choose a map item</option>
        {anchors.map((item) => <option key={item.itemId} value={item.itemId}>{item.name}</option>)}
      </select>
    </label>
    <label className="ul-field">
      <span className="ul-label">Key field of its buildings</span>
      <select className="ul-input" value={declaration.sourcePath} required disabled={!paths.length}
        aria-describedby={!paths.length ? reasonId : undefined}
        onChange={(event) => change({ sourcePath: event.target.value })}>
        <option value="">{declaration.anchorItemId && !paths.length ? 'Its card lists no fields'
          : 'Choose a field'}</option>
        {paths.map((path) => <option key={path} value={path}>{fieldWords(path)}</option>)}
      </select>
    </label>
    {!paths.length ? <DisabledReason id={reasonId} action={canChoose
      ? { label: 'Choose map item', press: () => focusSection(anchorId) } : undefined}>
      {declaration.anchorItemId ? 'Its card lists no key fields.' : 'Choose a map item.'}
    </DisabledReason> : null}
  </>;
}

function TableFields({ tables, declaration, change }: {
  tables: TableChoice[]; declaration: Declaration; change: Change;
}) {
  return <fieldset className={styles.group}>
    <legend className="ul-label">Key column of each table</legend>
    {tables.length ? null : <p>Read a CSV or workbook as a table first.</p>}
    {tables.map((table) => <label key={table.itemId} className="ul-field">
      <span className="ul-label">{table.name}</span>
      <select className="ul-input" value={declaration.columns[table.itemId] ?? ''}
        onChange={(event) => change({ columns: { ...declaration.columns, [table.itemId]: event.target.value } })}>
        <option value="">Not used</option>
        {table.headers.map((header, index) => <option key={index} value={String(index)}>{header}</option>)}
      </select>
    </label>)}
  </fieldset>;
}

function DocumentFields({ documents, declaration, change }: {
  documents: IntakeItem[]; declaration: Declaration; change: Change;
}) {
  if (!documents.length) return null;
  const toggle = (itemId: string, on: boolean) => change({ documents: on ? [...declaration.documents, itemId]
    : declaration.documents.filter((id) => id !== itemId) });
  return <fieldset className={styles.group}>
    <legend className="ul-label">Documents (optional)</legend>
    {documents.map((item) => <label key={item.itemId} className="ul-row">
      <input type="checkbox" checked={declaration.documents.includes(item.itemId)}
        onChange={(event) => toggle(item.itemId, event.target.checked)} />
      {item.name}
    </label>)}
  </fieldset>;
}
