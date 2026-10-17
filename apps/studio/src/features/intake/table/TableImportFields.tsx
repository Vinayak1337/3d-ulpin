import type { WorkItem } from '../../../api/queries';
import styles from './Table.module.css';

export function SourceCaseFields({ cases, caseId, setCaseId, name, setName, mode, setMode, locked }: {
  cases: WorkItem[]; caseId: string; setCaseId: (value: string) => void; name: string;
  setName: (value: string) => void; mode: 'existing' | 'create';
  setMode: (value: 'existing' | 'create') => void; locked: boolean;
}) {
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
        <span className="ul-help">
          Select a listed case or enter its ID. Site assignment is checked before retention.
        </span>
      </label> : <label className="ul-field">
        <span className="ul-label">New case name</span>
        <input className="ul-input" value={name} disabled={locked} maxLength={200} required
          onChange={(event) => setName(event.target.value)} />
      </label>}
    </div>
  );
}

export function TableSelectionFields({ file, sheet, setSheet, rows, setRows }: {
  file: File; sheet: string; setSheet: (value: string) => void;
  rows: string; setRows: (value: string) => void;
}) {
  if (/\.csv$/i.test(file.name)) return <p className="ul-help">CSV · sheet csv · header row 1</p>;
  return (
    <div className={styles.fields}>
      <label className="ul-field">
        <span className="ul-label">Exact sheet name</span>
        <input className="ul-input" aria-label="Exact sheet name" value={sheet} required
          onChange={(event) => setSheet(event.target.value)} />
        <span className="ul-help">The API cannot list sheets. Enter the name from the workbook.</span>
      </label>
      <label className="ul-field">
        <span className="ul-label">Header row numbers</span>
        <input className="ul-input" aria-label="Header row numbers" value={rows} required
          onChange={(event) => setRows(event.target.value)} />
        <span className="ul-help">1–5 increasing row numbers, separated by commas.</span>
      </label>
    </div>
  );
}
