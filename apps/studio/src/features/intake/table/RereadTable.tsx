import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@ulpin/ui';
import { TableRefusal } from './Progress';
import { tableKey } from './queries';
import { officerEncodingSelection, readBatchCase, type TableFromOriginalBody } from './retain';
import { TableSelectionFields } from './TableImportFields';
import type { TableProfile } from './types';
import { jobWords, useFollowTable } from './useFollowTable';
import styles from './Table.module.css';

type Follow = ReturnType<typeof useFollowTable>['follow'];

/** A lost response retries the same request; changing the stated encoding starts a new request. */
export function createEncodingReread(profile: TableProfile, follow: Follow) {
  let body: TableFromOriginalBody | null = null;
  return async (encoding: string) => {
    const selection = officerEncodingSelection(profile.tabular.selection, encoding);
    if (body?.selection.encoding !== selection.encoding) body = null;
    body ??= { requestKey: crypto.randomUUID(),
      expectedWorkspaceRevision: (await readBatchCase(profile.caseId)).revision, selection };
    try {
      return await follow(profile.caseId, profile.source.sourceId, body, () => { body = null; });
    } catch (error) {
      // A stale revision needs a fresh workspace pin, not an endlessly replayed request.
      if (error instanceof Error && 'status' in error && Number(error.status) < 500
        && Number(error.status) !== 429) body = null;
      throw error;
    }
  };
}

export function RereadTable({ profile }: { profile: TableProfile }) {
  const [encoding, setEncoding] = useState('');
  const { follow, open, job, reset } = useFollowTable();
  const client = useQueryClient();
  const [send] = useState(() => createEncodingReread(profile, follow));
  const press = useMutation({
    mutationFn: () => {
      reset();
      return send(encoding);
    },
    onSuccess: async (opened) => {
      await client.invalidateQueries({ queryKey: tableKey(opened.caseId, opened.sourceId) });
      await client.invalidateQueries({ queryKey: ['source-case', opened.caseId] });
      open(opened);
    },
  });
  if (profile.tabular.selection.format !== 'csv') return null;
  return <EncodingRereadForm encoding={encoding} setEncoding={setEncoding} pending={press.isPending}
    submit={() => press.mutate()} error={press.error}
    reading={press.isPending && job ? jobWords(job, 'CSV') : null} />;
}

export function EncodingRereadForm({ encoding, setEncoding, pending, submit, error, reading }: {
  encoding: string; setEncoding: (value: string) => void; pending: boolean; submit: () => void;
  error: Error | null; reading: string | null;
}) {
  return <details className="ul-panel ul-pad">
    <summary>Read again with a stated encoding</summary>
    <form className={styles.form} onSubmit={(event) => {
      event.preventDefault();
      submit();
    }}>
      <fieldset className={styles.fieldset} disabled={pending}>
        <TableSelectionFields format="csv" sheet="csv" rows="1" setSheet={() => {}} setRows={() => {}}
          encoding={encoding} setEncoding={setEncoding} />
      </fieldset>
      <div><Button type="submit" disabled={pending || !encoding}>Read again</Button></div>
      {reading ? <p role="status">{reading}</p> : null}
      {error ? <TableRefusal error={error} /> : null}
    </form>
  </details>;
}
