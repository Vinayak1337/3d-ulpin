import { useState } from 'react';
import { Banner, Button, DataTable, Dialog } from '@ulpin/ui';
import { useWorkQueue } from '../../api/queries';
import { SourceCaseFields } from './table/TableImportFields';
import { useRetainBatch } from './useRetainBatch';
import type { FileOutcome } from './retain-batch';
import { LARGE_UPLOAD_MINIMUM, uploadWords } from './upload-model';
import styles from './Batch.module.css';

export function IntakeDropDialog({ files, remainingFiles, openCaseId, onBack, onClose, routed }: {
  files: File[]; remainingFiles: File[]; openCaseId?: string; onBack: () => void;
  onClose: () => void; routed: boolean;
}) {
  const cases = useWorkQueue('all', '', 1).data?.items.filter((item) => item.kind === 'case') ?? [];
  const [mode, setMode] = useState<'existing' | 'create'>(openCaseId ? 'existing' : 'create');
  const [caseId, setCaseId] = useState(openCaseId ?? '');
  const [name, setName] = useState('');
  const { rows, pending, error, retain, created, clearCreated, retryUpload, cancelUpload } = useRetainBatch(
    files, remainingFiles, mode, caseId, name, onClose, routed);
  const blocked = mode === 'existing' ? !caseId.trim() : !name.trim();
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
          mode={mode} setMode={(value) => {
            clearCreated();
            setMode(value);
          }} locked={created} />
      </fieldset>
      {files.some(file => file.size >= LARGE_UPLOAD_MINIMUM) ?
        <p className="ul-help">Keep this page open until the upload finishes.</p> : null}
      <DropOutcomes rows={rows} />
      {rows.some(row => row.upload?.phase === 'stopped') ? <div className="ul-row">
        <Button onClick={retryUpload}>Try again</Button>
        <Button variant="soft" onClick={() => void cancelUpload()}>Cancel upload</Button>
      </div> : null}
      {remainingFiles.length ? <p className="ul-help">
        Other files stay separate. Continue with them from the batch after these map files are retained.
      </p> : null}
      {error ? <Banner tone="danger">{error}</Banner> : null}
    </div>
  </Dialog>;
}

export function DropOutcomes({ rows }: { rows: FileOutcome[] }) {
  return <DataTable caption="Files added to the batch" rows={rows}
    rowKey={(row) => String(rows.indexOf(row))} columns={[
    { header: 'File', cell: (row) => row.name },
    { header: 'Size', numeric: true, cell: (row) => `${row.sizeBytes.toLocaleString('en-IN')} bytes` },
    { header: 'Outcome', cell: (row) => row.state === 'retaining' && row.upload
      ? uploadWords(row.upload) : outcomeWords[row.state] },
    { header: 'Reason', cell: (row) => row.message ?? 'Not applicable' },
  ]} />;
}

const outcomeWords: Record<FileOutcome['state'], string> = {
  waiting: 'Waiting', retaining: 'Retaining original', enrolled: 'Added to batch',
  refused: 'Refused', not_enrolled: 'Not confirmed in batch',
};
