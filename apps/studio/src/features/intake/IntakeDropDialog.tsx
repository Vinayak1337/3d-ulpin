import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Banner, Button, DataTable, Dialog } from '@ulpin/ui';
import { useWorkQueue } from '../../api/queries';
import { SourceCaseFields } from './table/TableImportFields';
import { batchCase, initialOutcomes, retainBatch } from './retain-batch';
import type { FileOutcome } from './retain-batch';
import styles from './Batch.module.css';

export function IntakeDropDialog({ files, remainingFiles, openCaseId, onBack, onClose, routed }: {
  files: File[]; remainingFiles: File[]; openCaseId?: string; onBack: () => void;
  onClose: () => void; routed: boolean;
}) {
  const navigate = useNavigate();
  const cases = useWorkQueue('all', '', 1).data?.items.filter((item) => item.kind === 'case') ?? [];
  const [mode, setMode] = useState<'existing' | 'create'>(openCaseId ? 'existing' : 'create');
  const [caseId, setCaseId] = useState(openCaseId ?? '');
  const [name, setName] = useState('');
  const [rows, setRows] = useState(() => initialOutcomes(files));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const created = useRef('');
  const inFlight = useRef(false);
  const blocked = mode === 'existing' ? !caseId.trim() : !name.trim();
  const retain = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      const id = created.current || await batchCase(mode, caseId.trim(), name);
      created.current = id;
      const outcomes = await retainBatch(id, files, setRows);
      if (!routed) onClose();
      navigate(`/studio/work/cases/${id}/intake`, { replace: routed, state: { outcomes, remainingFiles } });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The batch could not be opened.');
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };
  return <Dialog title="Retain map files" onClose={pending ? () => undefined : onClose} footer={(
    <><Button variant="ghost" disabled={pending} onClick={onBack}>Back to files</Button>
      <Button variant="primary" disabled={blocked || pending} onClick={() => void retain()}>
        {pending ? 'Retaining files…' : 'Retain files and open batch'}
      </Button></>
  )}>
    <div className={styles.stack}>
      <p>Each original is retained unchanged, then checked in this batch. Nothing is recorded yet.</p>
      <fieldset className={styles.fieldset} disabled={pending}>
        <legend className="ul-visually-hidden">Choose the batch</legend>
        <SourceCaseFields cases={cases} caseId={caseId} setCaseId={setCaseId} name={name} setName={setName}
          mode={mode} setMode={(value) => { created.current = ''; setMode(value); }} locked={Boolean(created.current)} />
      </fieldset>
      <DropOutcomes rows={rows} />
      {remainingFiles.length ? <p className="ul-help">
        Other files stay separate. Continue with them from the batch after these map files are retained.
      </p> : null}
      {error ? <Banner tone="danger">{error}</Banner> : null}
    </div>
  </Dialog>;
}

export function DropOutcomes({ rows }: { rows: FileOutcome[] }) {
  return <DataTable caption="Files sent to the intake" rows={rows} rowKey={(row) => String(rows.indexOf(row))} columns={[
    { header: 'File', cell: (row) => row.name },
    { header: 'Size', numeric: true, cell: (row) => `${row.sizeBytes.toLocaleString('en-IN')} bytes` },
    { header: 'Outcome', cell: (row) => outcomeWords[row.state] },
    { header: 'Reason', cell: (row) => row.message ?? 'Not applicable' },
  ]} />;
}

const outcomeWords: Record<FileOutcome['state'], string> = {
  waiting: 'Waiting to retain', retaining: 'Retaining original', enrolled: 'Added to batch',
  refused: 'Refused', not_enrolled: 'Not confirmed in batch',
};
