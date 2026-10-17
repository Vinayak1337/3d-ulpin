import { useState } from 'react';
import { Banner, Button, Dialog } from '@ulpin/ui';
import { useWorkQueue } from '../../../api/queries';
import { TableRefusal } from './Progress';
import { useRetainTable } from './useRetainTable';
import { TableSelectionFields, SourceCaseFields } from './TableImportFields';
import styles from './Table.module.css';

export function TableImportDialog({ file, onClose, onBack }: {
  file: File; onClose: () => void; onBack: () => void;
}) {
  const cases = useWorkQueue('all', '', 1).data?.items.filter((item) => item.kind === 'case') ?? [];
  const [caseId, setCaseId] = useState('');
  const [name, setName] = useState('');
  const [mode, setMode] = useState<'existing' | 'create'>('existing');
  const [sheet, setSheet] = useState('');
  const [rows, setRows] = useState('');
  const { retain, created, clearCreated } = useRetainTable(file, caseId, name, mode, sheet, rows);
  const blocked = mode === 'create' ? !name.trim() : !caseId;
  return <ImportDialogBody file={file} onClose={onClose} onBack={onBack} pending={retain.isPending}
    blocked={blocked} submit={() => retain.mutate()} error={retain.error}>
    <SourceCaseFields cases={cases} caseId={caseId} setCaseId={setCaseId} name={name} setName={setName}
      mode={mode} setMode={(value) => {
        clearCreated();
        setMode(value);
      }} locked={created} />
    <TableSelectionFields file={file} sheet={sheet} setSheet={setSheet} rows={rows} setRows={setRows} />
  </ImportDialogBody>;
}

function ImportDialogBody({ file, onClose, onBack, pending, blocked, submit, error, children }: {
  file: File; onClose: () => void; onBack: () => void; pending: boolean; blocked: boolean;
  submit: () => void; error: Error | null; children: React.ReactNode;
}) {
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
          Only exact public D8 development originals are admitted. Other files will be refused by the server.
          Tables create mapped draft rows, not buildings; nothing enters the registry or appears on the map.
        </Banner>
        <fieldset className={styles.fieldset} disabled={pending}>{children}</fieldset>
        {error ? <TableRefusal error={error} /> : null}
      </div>
    </Dialog>
  );
}
