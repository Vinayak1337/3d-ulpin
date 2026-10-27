import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ApiError } from '@ulpin/api-client';
import { createUploadCommand } from '../upload-command';
import { uploadTransport } from '../upload-api';
import type { UploadProgress } from '../upload-model';
import { createSourceCase, readSourceCase, tableSelection, type TableFromOriginalBody } from './retain';
import { useFollowTable, type Opened } from './useFollowTable';

type Upload = ReturnType<typeof createUploadCommand>;
export type Kept = { current: { caseId: string; sourceId: string; body: TableFromOriginalBody | null } | null };
type Follow = ReturnType<typeof useFollowTable>['follow'];

/**
 * TB2: a table dropped alone is kept first, through the uploads route at any size, and then read from that kept
 * original; the server reads it whole, or as a stream past the whole-file bound. The original is uploaded once per
 * case: a retry only asks the server to read it again, and a read that stopped is asked for with a new request key.
 */
export async function readKeptTable(caseId: string, selection: TableFromOriginalBody['selection'], kept: Kept,
  upload: (caseId: string) => Promise<string | null>, follow: Follow): Promise<Opened> {
  if (kept.current?.caseId !== caseId) {
    const sourceId = await upload(caseId);
    if (!sourceId) throw new Error('The upload was cancelled; nothing was imported.');
    kept.current = { caseId, sourceId, body: null };
  }
  const current = kept.current;
  if (JSON.stringify(current.body?.selection) !== JSON.stringify(selection)) current.body = null;
  const body = current.body ??= { requestKey: crypto.randomUUID(),
    expectedWorkspaceRevision: (await readSourceCase(caseId)).revision, selection };
  return follow(caseId, current.sourceId, body, () => { current.body = null; });
}

/** `imported`, when given, takes the read table instead of opening its page: the drop has other files to route. */
export function useRetainTable(file: File, caseId: string, name: string, mode: 'existing' | 'create',
  sheet: string, rows: string, imported?: (opened: Opened) => void) {
  const created = useRef<string | null>(null);
  const kept = useRef<Kept['current']>(null);
  const command = useRef<Upload | null>(null);
  const [upload, setUpload] = useState<UploadProgress | null>(null);
  const { job, reset, follow, open } = useFollowTable();
  const send = (id: string) => {
    command.current = createUploadCommand({ file, acquiredAt: new Date().toISOString(),
      transport: uploadTransport(id), publish: setUpload });
    return command.current.run().finally(() => { command.current = null; });
  };
  const retain = useMutation({
    mutationFn: async () => {
      const selection = tableSelection(file, sheet, rows);
      let id = caseId;
      if (mode === 'create') {
        if (!created.current) created.current = (await createSourceCase(name)).id;
        id = created.current;
      }
      reset();
      return readKeptTable(id, selection, kept, send, follow);
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409 && kept.current) kept.current.body = null;
    },
    onSuccess: (opened: Opened) => (imported ?? open)(opened),
  });
  return { retain, created: Boolean(created.current), clearCreated: () => { created.current = null; },
    upload, retryUpload: () => command.current?.retry(), job };
}
