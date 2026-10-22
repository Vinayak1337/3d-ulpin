import { useState } from 'react';
import { Banner, Button, Dialog } from '@ulpin/ui';
import { useWorkQueue } from '../../../api/queries';
import { uploadWords, type UploadProgress } from '../upload-model';
import { streamedImport, tableFormat } from './retain';
import { TableRefusal } from './Progress';
import { jobWords, type Opened } from './useFollowTable';
import { useRetainTable } from './useRetainTable';
import { TableSelectionFields, SourceCaseFields } from './TableImportFields';
import type { TableJob } from './types';
import styles from './Table.module.css';

export function TableImportDialog({ file, onClose, onBack, onImported }: {
  file: File; onClose: () => void; onBack: () => void; onImported?: (opened: Opened) => void;
}) {
  const cases = useWorkQueue('all', '', 1).data?.items.filter((item) => item.kind === 'case') ?? [];
  const [caseId, setCaseId] = useState('');
  const [name, setName] = useState('');
  const [mode, setMode] = useState<'existing' | 'create'>('existing');
  const [sheet, setSheet] = useState('');
  const [rows, setRows] = useState('');
  const { retain, created, clearCreated, upload, retryUpload, job } = useRetainTable(file, caseId, name, mode, sheet,
    rows, onImported);
  const blocked = mode === 'create' ? !name.trim() : !caseId;
  return <ImportDialogBody file={file} onClose={onClose} onBack={onBack} pending={retain.isPending}
    blocked={blocked} submit={() => retain.mutate()} error={retain.error}
    upload={retain.isPending ? upload : null} retryUpload={retryUpload} job={retain.isPending ? job : null}>
    <SourceCaseFields cases={cases} caseId={caseId} setCaseId={setCaseId} name={name} setName={setName}
      mode={mode} setMode={(value) => {
        clearCreated();
        setMode(value);
      }} locked={created} />
    <TableSelectionFields format={tableFormat(file)} sheet={sheet} setSheet={setSheet} rows={rows}
      setRows={setRows} />
  </ImportDialogBody>;
}

function ImportDialogBody({ file, onClose, onBack, pending, blocked, submit, error, upload, retryUpload, job,
  children }: {
  file: File; onClose: () => void; onBack: () => void; pending: boolean; blocked: boolean;
  submit: () => void; error: Error | null; upload: UploadProgress | null; retryUpload: () => void;
  job: TableJob | null; children: React.ReactNode;
}) {
  const workbook = /\.xlsx$/i.test(file.name), reading = job ? jobWords(job, workbook ? 'workbook' : 'CSV') : null;
  return (
    <Dialog title="Import as a table" onClose={onClose} footer={(
      <><Button variant="ghost" onClick={onBack} disabled={pending}>Back to files</Button>
        <Button variant="primary" disabled={blocked || pending} onClick={submit}>
          {error ? 'Retry' : 'Retain table and start mapping'}
        </Button></>
    )}>
      <div className={styles.form}>
        <p className="ul-id">{file.name}</p>
        <Banner tone="info">
          The file is kept unchanged first, then read as a table; a table of more than 2,000 records is read as a
          stream. Tables create mapped draft rows, not buildings; nothing enters the registry.
        </Banner>
        {streamedImport(file) ? <StreamedHelp workbook={workbook} /> : null}
        <fieldset className={styles.fieldset} disabled={pending}>{children}</fieldset>
        {upload ? <p role="status">{uploadWords(upload)}</p> : null}
        {upload?.phase === 'stopped' ? <div><Button onClick={retryUpload}>Retry upload</Button></div> : null}
        {reading ? <p role="status">{reading}</p> : null}
        {error ? <TableRefusal error={error} /> : null}
      </div>
    </Dialog>
  );
}

function StreamedHelp({ workbook }: { workbook: boolean }) {
  return workbook ? <p className="ul-help">
    This workbook is above 16 MiB. It is uploaded in parts, kept unchanged, and the sheet you name is read as a
    stream of up to 1,000,000 records. Formulas are not calculated; a formula's stored result is kept and read as
    unknown.
  </p> : <p className="ul-help">
    This CSV is above 16 MiB. It is uploaded in parts, kept unchanged, and read as a stream of up to
    1,000,000 records.
  </p>;
}
