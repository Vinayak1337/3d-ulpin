import { useState } from 'react';
import { Banner, Button, DataTable, Dialog } from '@ulpin/ui';
import { useWorkQueue } from '../../api/queries';
import { SourceCaseFields } from './table/TableImportFields';
import { useRetainBatch } from './useRetainBatch';
import { viaUpload, type FileOutcome } from './retain-batch';
import { readerEligibility, sizeWords, uploadWords } from './upload-model';
import styles from './Batch.module.css';

export function IntakeDropDialog({ files, remainingFiles, openCaseId, onBack, onClose, routed }: {
  files: File[]; remainingFiles: File[]; openCaseId?: string; onBack: () => void;
  onClose: () => void; routed: boolean;
}) {
  const cases = useWorkQueue('all', '', 1).data?.items.filter((item) => item.kind === 'case') ?? [];
  const [mode, setMode] = useState<'existing' | 'create'>(openCaseId ? 'existing' : 'create');
  const [caseId, setCaseId] = useState(openCaseId ?? '');
  const [name, setName] = useState('');
  const { rows, pending, error, retain, created, clearCreated } = useRetainBatch(
    files, remainingFiles, mode, caseId, name, onClose, routed);
  const blocked = mode === 'existing' ? !caseId.trim() : !name.trim();
  return <Dialog title="Retain files" onClose={pending ? () => undefined : onClose} footer={(
    <><Button variant="ghost" disabled={pending} onClick={onBack}>Back to files</Button>
      <Button variant="primary" disabled={blocked || pending} onClick={() => void retain()}>
        {pending ? 'Opening batch…' : 'Retain files and open batch'}
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
      <p className="ul-help">Reader estimates use file names and sizes, not checked contents. Other reader limits
        and questions are checked after upload. Reading does not mean placement on the map or a recorded property.</p>
      {files.some(viaUpload) ? <p className="ul-help">
        The batch opens before upload finishes. Keep its page open to send the files and see progress.
      </p> : null}
      <DropOutcomes rows={rows} readers />
      {remainingFiles.length ? <p className="ul-help">
        Other files stay separate. Continue with them from the batch after these files are retained.
      </p> : null}
      {error ? <Banner tone="danger">{error}</Banner> : null}
    </div>
  </Dialog>;
}

export function DropOutcomes({ rows, readers = false }: { rows: FileOutcome[]; readers?: boolean }) {
  return <DataTable caption={readers ? 'Files to retain' : 'Files in this drop'} rows={rows}
    rowKey={(row) => String(rows.indexOf(row))} columns={[
    { header: 'File', cell: (row) => row.name },
    { header: 'Size', numeric: true, cell: (row) => sizeWords(row.sizeBytes) },
    ...(readers ? [{ header: 'Reader estimate', cell: (row: FileOutcome) =>
      readerEligibility({ name: row.name, size: row.sizeBytes }).words }] : []),
    { header: 'Outcome', cell: (row) => row.state === 'retaining' && row.upload
      ? uploadWords(row.upload) : outcomeWords[row.state] },
    { header: 'Upload progress', cell: (row) => row.state === 'retaining' && row.upload
      && row.upload.phase !== 'waiting'
      ? `${sizeWords(row.upload.doneBytes)} of ${sizeWords(row.upload.totalBytes)}; `
        + `part ${row.upload.part} of ${row.upload.parts}` : null },
    { header: 'Reason', cell: (row) => row.message ?? null },
  ]} />;
}

const outcomeWords: Record<FileOutcome['state'], string> = {
  waiting: 'Waiting', retaining: 'Retaining original', enrolled: 'Added to batch',
  refused: 'Refused', not_enrolled: 'Not confirmed in batch',
};
