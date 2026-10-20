import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ApiError } from '@ulpin/api-client';
import { createUploadCommand } from '../upload-command';
import { uploadTransport } from '../upload-api';
import type { UploadProgress } from '../upload-model';
import { createSourceCase, readSourceCase, retainForm, retainTable, streamedImport, tableSelection,
  type TableFromOriginalBody } from './retain';
import { useFollowTable, type Opened } from './useFollowTable';

type Upload = ReturnType<typeof createUploadCommand>;
type Kept = { current: { caseId: string; sourceId: string; body: TableFromOriginalBody | null } | null };
type Follow = ReturnType<typeof useFollowTable>['follow'];

/** The original is uploaded once per case; a retry after that only asks the server to read it again, and a read
 * that stopped is asked for again with a new request key. */
async function streamedTable(file: File, caseId: string, selection: TableFromOriginalBody['selection'], kept: Kept,
  started: (command: Upload | null) => void, publish: (progress: UploadProgress) => void, follow: Follow) {
  if (kept.current?.caseId !== caseId) {
    const command = createUploadCommand({ file, acquiredAt: new Date().toISOString(),
      transport: uploadTransport(caseId), publish });
    started(command);
    const sourceId = await command.run().finally(() => started(null));
    if (!sourceId) throw new Error('The upload was cancelled; nothing was imported.');
    kept.current = { caseId, sourceId, body: null };
  }
  const current = kept.current;
  const body = current.body ??= { requestKey: crypto.randomUUID(),
    expectedWorkspaceRevision: (await readSourceCase(caseId)).revision, selection };
  return follow(caseId, current.sourceId, body, () => { current.body = null; });
}

/** `imported`, when given, takes the read table instead of opening its page: the drop has other files to route. */
export function useRetainTable(file: File, caseId: string, name: string, mode: 'existing' | 'create',
  sheet: string, rows: string, imported?: (opened: Opened) => void) {
  const created = useRef<string | null>(null);
  const attempt = useRef<{ signature: string; caseId: string; body: FormData } | null>(null);
  const kept = useRef<Kept['current']>(null);
  const command = useRef<Upload | null>(null);
  const [upload, setUpload] = useState<UploadProgress | null>(null);
  const { job, reset, follow, open } = useFollowTable();
  const retain = useMutation({
    mutationFn: async () => {
      const selection = tableSelection(file, sheet, rows);
      let id = caseId;
      if (mode === 'create') {
        if (!created.current) created.current = (await createSourceCase(name)).id;
        id = created.current;
      }
      if (streamedImport(file)) {
        reset();
        return streamedTable(file, id, selection, kept, (value) => { command.current = value; }, setUpload, follow);
      }
      const signature = JSON.stringify({ id, selection });
      if (!attempt.current || attempt.current.signature !== signature) {
        const sourceCase = await readSourceCase(id);
        const body = retainForm(file, selection, sourceCase.revision, crypto.randomUUID());
        attempt.current = { signature, caseId: id, body };
      }
      // Network/busy retries replay exactly the same pins and key, even if retention already committed.
      const profile = await retainTable(attempt.current.caseId, attempt.current.body);
      return { caseId: profile.caseId, sourceId: profile.source.sourceId };
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) {
        attempt.current = null;
        if (kept.current) kept.current.body = null;
      }
    },
    onSuccess: (opened: Opened) => (imported ?? open)(opened),
  });
  return { retain, created: Boolean(created.current), clearCreated: () => { created.current = null; },
    upload, retryUpload: () => command.current?.retry(), job };
}
