import { useState } from 'react';
import { Banner, Button, DataTable, Dialog, formatDateTime } from '@ulpin/ui';
import { useWorkQueue } from '../../api/queries';
import { SourceCaseFields } from './table/TableImportFields';
import { useRetainBatch } from './useRetainBatch';
import type { FileOutcome } from './retain-batch';
import { readerEligibility, sizeWords, uploadWords } from './upload-model';
import styles from './Batch.module.css';

export function IntakeDropDialog({ files, remainingFiles, openCaseId, onBack, onClose, routed }: {
  files: File[]; remainingFiles: File[]; openCaseId?: string; onBack: () => void;
  onClose: () => void; routed: boolean;
}) {
  const cases = useWorkQueue('all', '', 1).data?.items.filter((item) => item.kind === 'case') ?? [];
  const [mode, setMode] = useState<'existing' | 'create'>(openCaseId ? 'existing' : 'create');
  const [caseId, setCaseId] = useState(openCaseId ?? '');
  const [name, setName] = useState(() =>
    `${files[0]?.name.replace(/\.[^.]+$/, '') ?? ''} ${formatDateTime(new Date().toISOString())}`);
  const { rows, pending, error, retain, created, clearCreated } = useRetainBatch(
    files, remainingFiles, mode, caseId, name, onClose, routed);
  const blocked = mode === 'existing' ? !caseId.trim() : !name.trim();
  return <Dialog title="Add files" onClose={pending ? () => undefined : onClose} footer={(
    <><Button variant="ghost" disabled={pending} onClick={onBack}>Back to files</Button>
      <Button variant="primary" disabled={blocked || pending} onClick={() => void retain()}>
        {pending ? 'Adding files…' : `Add ${files.length} ${files.length === 1 ? 'file' : 'files'}`}
      </Button></>
  )}>
    <div className={styles.stack}>
      <fieldset className={styles.fieldset} disabled={pending}>
        <legend className="ul-visually-hidden">Choose the batch</legend>
        <SourceCaseFields cases={cases} caseId={caseId} setCaseId={setCaseId} name={name} setName={setName}
          mode={mode} setMode={(value) => {
            clearCreated();
            setMode(value);
          }} locked={created} />
      </fieldset>
      <DropOutcomes rows={rows} readers />
      {error ? <Banner tone="danger">{error}</Banner> : null}
    </div>
  </Dialog>;
}

export function DropOutcomes({ rows, readers = false }: { rows: FileOutcome[]; readers?: boolean }) {
  return <DataTable caption={readers ? 'Files' : 'Files in this drop'} rows={rows}
    rowKey={(row) => String(rows.indexOf(row))} columns={[
    { header: 'File', cell: (row) => row.name },
    { header: 'Size', numeric: true, cell: (row) => sizeWords(row.sizeBytes) },
    ...(readers ? [{ header: 'Reader', cell: (row: FileOutcome) =>
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
  waiting: 'Waiting', retaining: 'Keeping the original', enrolled: 'Added to batch',
  refused: 'Refused', not_enrolled: 'Not confirmed in batch',
};
