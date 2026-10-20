import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { ApiError } from '@ulpin/api-client';
import { createUploadCommand } from '../upload-command';
import { uploadTransport } from '../upload-api';
import type { UploadProgress } from '../upload-model';
import { createSourceCase, readSourceCase, retainForm, retainTable, streamedImport, tableFromOriginal,
  tableSelection, type TableFromOriginalBody } from './retain';

type Upload = ReturnType<typeof createUploadCommand>;

/** The original is uploaded once per case; a retry after that only asks the server to read it again. */
async function streamedTable(file: File, caseId: string, selection: TableFromOriginalBody['selection'],
  kept: { current: { caseId: string; sourceId: string; body: TableFromOriginalBody | null } | null },
  started: (command: Upload | null) => void, publish: (progress: UploadProgress) => void) {
  if (kept.current?.caseId !== caseId) {
    const command = createUploadCommand({ file, acquiredAt: new Date().toISOString(),
      transport: uploadTransport(caseId), publish });
    started(command);
    const sourceId = await command.run().finally(() => started(null));
    if (!sourceId) throw new Error('The upload was cancelled; nothing was imported.');
    kept.current = { caseId, sourceId, body: null };
  }
  kept.current.body ??= { requestKey: crypto.randomUUID(),
    expectedWorkspaceRevision: (await readSourceCase(caseId)).revision, selection };
  return tableFromOriginal(caseId, kept.current.sourceId, kept.current.body);
}

export function useRetainTable(file: File, caseId: string, name: string, mode: 'existing' | 'create',
  sheet: string, rows: string) {
  const navigate = useNavigate();
  const created = useRef<string | null>(null);
  const attempt = useRef<{ signature: string; caseId: string; body: FormData } | null>(null);
  const kept = useRef<{ caseId: string; sourceId: string; body: TableFromOriginalBody | null } | null>(null);
  const command = useRef<Upload | null>(null);
  const [upload, setUpload] = useState<UploadProgress | null>(null);
  const retain = useMutation({
    mutationFn: async () => {
      const selection = tableSelection(file, sheet, rows);
      let id = caseId;
      if (mode === 'create') {
        if (!created.current) created.current = (await createSourceCase(name)).id;
        id = created.current;
      }
      if (streamedImport(file)) {
        return streamedTable(file, id, selection, kept, (value) => { command.current = value; }, setUpload);
      }
      const signature = JSON.stringify({ id, selection });
      if (!attempt.current || attempt.current.signature !== signature) {
        const sourceCase = await readSourceCase(id);
        const body = retainForm(file, selection, sourceCase.revision, crypto.randomUUID());
        attempt.current = { signature, caseId: id, body };
      }
      // Network/busy retries replay exactly the same pins and key, even if retention already committed.
      return retainTable(attempt.current.caseId, attempt.current.body);
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) {
        attempt.current = null;
        if (kept.current) kept.current.body = null;
      }
    },
    onSuccess: (profile) => navigate(`/studio/work/cases/${profile.caseId}/tables/${profile.source.sourceId}`, {
      state: { queueKeys: { raw: crypto.randomUUID(), mapping: crypto.randomUUID() } },
    }),
  });
  return { retain, created: Boolean(created.current), clearCreated: () => { created.current = null; },
    upload, retryUpload: () => command.current?.retry() };
}
