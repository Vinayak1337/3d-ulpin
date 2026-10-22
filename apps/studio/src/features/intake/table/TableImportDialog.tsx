import { useState } from 'react';
import { Link } from 'react-router';
import { ApiError } from '@ulpin/api-client';
import { Banner, Button, Dialog } from '@ulpin/ui';
import { useWorkQueue } from '../../../api/queries';
import { uploadWords, type UploadProgress } from '../upload-model';
import { largeOds, streamedImport, tableFormat } from './retain';
import { TableRefusal } from './Progress';
import { jobWords, tablePath, type Opened } from './useFollowTable';
import { useRetainTable } from './useRetainTable';
import { TableSelectionFields, SourceCaseFields } from './TableImportFields';
import type { TableJob } from './types';
import styles from './Table.module.css';

const isTableId = (value: unknown): value is string => typeof value === 'string'
  && /^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);

/** Error details are untyped in the contract; only a validated table reference replaces the refusal. */
function existingTableOf(error: unknown) {
  if (!(error instanceof ApiError) || error.status !== 409) return null;
  const body = error.body as { error?: { details?: { existingTable?: Record<string, unknown> } } } | null;
  const target = body?.error?.details?.existingTable;
  if (!isTableId(target?.caseId) || !isTableId(target?.sourceId)) return null;
  if (target.tableId !== target.sourceId) return null;
  return { caseId: target.caseId, sourceId: target.sourceId };
}

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
  const workbook = tableFormat(file) !== 'csv', reading = job ? jobWords(job, workbook ? 'workbook' : 'CSV') : null;
  const existing = existingTableOf(error);
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
        {largeOds(file) ? <p className="ul-help">{LARGE_ODS}</p> : null}
        <fieldset className={styles.fieldset} disabled={pending}>{children}</fieldset>
        {upload ? <p role="status">{uploadWords(upload)}</p> : null}
        {upload?.phase === 'stopped' ? <div><Button onClick={retryUpload}>Retry upload</Button></div> : null}
        {reading ? <p role="status">{reading}</p> : null}
        {existing ? <div className="ul-stack" role="alert">
          <Banner tone="warning">This file is already read as a table in this batch.</Banner>
          <Link to={tablePath(existing)}>Open that table</Link>
        </div> : null}
        {error && !existing ? <TableRefusal error={error} /> : null}
      </div>
    </Dialog>
  );
}

const LARGE_ODS = 'This ODS workbook is above 16 MiB. It is kept unchanged, but an ODS is read whole, up to 16 MiB, '
  + 'never as a stream, so its cells will not be read. Save it as XLSX or CSV to read it as a stream.';

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
