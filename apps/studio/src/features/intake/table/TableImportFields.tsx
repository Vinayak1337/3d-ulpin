import type { WorkItem } from '../../../api/queries';
import type { TableFormat } from './retain';
import type { Selection } from './types';
import styles from './Table.module.css';

export function SourceCaseFields({ cases, caseId, setCaseId, name, setName, mode, setMode, locked }: {
  cases: WorkItem[]; caseId: string; setCaseId: (value: string) => void; name: string;
  setName: (value: string) => void; mode: 'existing' | 'create';
  setMode: (value: 'existing' | 'create') => void; locked: boolean;
}) {
  const duplicate = cases.some(item => item.name.toLowerCase() === name.trim().toLowerCase());
  return (
    <div className={styles.fields}>
      <label className="ul-field">
        <span className="ul-label">Source case</span>
        <select className="ul-input" value={mode} onChange={(event) =>
          setMode(event.target.value as 'existing' | 'create')}>
          <option value="existing">Choose an existing case</option>
          <option value="create">Create an unassigned source case</option>
        </select>
      </label>
      {mode === 'existing' ? <label className="ul-field">
        <span className="ul-label">Case ID</span>
        <input className="ul-input" list="table-source-cases" aria-label="Case ID" value={caseId}
          onChange={(event) => setCaseId(event.target.value)} required />
        <datalist id="table-source-cases">
          {cases.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </datalist>
      </label> : <label className="ul-field">
        <span className="ul-label">New case name</span>
        <input className="ul-input" value={name} disabled={locked} maxLength={200} required
          aria-describedby={duplicate ? 'batch-name-warning' : undefined}
          onChange={(event) => setName(event.target.value)} />
        {duplicate ? <span id="batch-name-warning" className="ul-help">Another batch has this name</span> : null}
      </label>}
    </div>
  );
}

export const encodingLabels: Record<NonNullable<Selection['encoding']>, string> = {
  'utf-8': 'UTF-8', 'windows-1252': 'Windows-1252', 'iso-8859-1': 'ISO-8859-1',
  'utf-16le': 'UTF-16 LE', 'utf-16be': 'UTF-16 BE',
};

function DelimitedSelectionFields({ encoding, setEncoding }: {
  encoding?: string; setEncoding?: (value: string) => void;
}) {
  if (!setEncoding) return null;
  return (
    <label className="ul-field">
      <span className="ul-label">Stated encoding</span>
      <select className="ul-input" value={encoding ?? ''} required
        onChange={(event) => setEncoding(event.target.value)}>
        <option value="">Choose an encoding</option>
        {Object.entries(encodingLabels).map(([value, label]) =>
          <option key={value} value={value}>{label}</option>)}
      </select>
    </label>
  );
}

/** `sheets` are the sheet names a kept file's card states; without them the officer types the name. */
export function TableSelectionFields({ format, sheets, sheet, setSheet, rows, setRows, encoding, setEncoding }: {
  format: TableFormat; sheets?: readonly string[]; sheet: string; setSheet: (value: string) => void;
  rows: string; setRows: (value: string) => void; encoding?: string; setEncoding?: (value: string) => void;
}) {
  if (format === 'csv') return <DelimitedSelectionFields encoding={encoding} setEncoding={setEncoding} />;
  return (
    <div className={styles.fields}>
      <label className="ul-field">
        <span className="ul-label">Exact sheet name</span>
        <input className="ul-input" aria-label="Exact sheet name" value={sheet} required
          list={sheets?.length ? 'table-stated-sheets' : undefined}
          onChange={(event) => setSheet(event.target.value)} />
        {sheets?.length ? <datalist id="table-stated-sheets">
          {sheets.map((name) => <option key={name} value={name} />)}
        </datalist> : null}
        {sheets?.length ? <span className="ul-help">
          {`The file's card states ${sheets.length === 1 ? 'this sheet' : 'these sheets'}: ${sheets.join(', ')}.`}
        </span> : null}
      </label>
      <label className="ul-field">
        <span className="ul-label">Header row numbers</span>
        <input className="ul-input" aria-label="Header row numbers" value={rows} required
          onChange={(event) => setRows(event.target.value)} />
      </label>
    </div>
  );
}
