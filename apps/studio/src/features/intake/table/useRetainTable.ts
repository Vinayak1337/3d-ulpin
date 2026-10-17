import { useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { ApiError } from '@ulpin/api-client';
import { createSourceCase, readSourceCase, retainForm, retainTable, tableSelection } from './retain';

export function useRetainTable(file: File, caseId: string, name: string, mode: 'existing' | 'create',
  sheet: string, rows: string) {
  const navigate = useNavigate();
  const created = useRef<string | null>(null);
  const attempt = useRef<{ signature: string; caseId: string; body: FormData } | null>(null);
  const retain = useMutation({
    mutationFn: async () => {
      const selection = tableSelection(file, sheet, rows);
      let id = caseId;
      if (mode === 'create') {
        if (!created.current) created.current = (await createSourceCase(name)).id;
        id = created.current;
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
      if (error instanceof ApiError && error.status === 409) attempt.current = null;
    },
    onSuccess: (profile) => navigate(`/studio/work/cases/${profile.caseId}/tables/${profile.source.sourceId}`, {
      state: { queueKeys: { raw: crypto.randomUUID(), mapping: crypto.randomUUID() } },
    }),
  });
  return { retain, created: Boolean(created.current), clearCreated: () => { created.current = null; } };
}
