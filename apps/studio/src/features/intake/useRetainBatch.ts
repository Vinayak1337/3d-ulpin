import { useRef, useState } from 'react';
import { useBeforeUnload, useNavigate } from 'react-router';
import type { createUploadCommand } from './upload-command';
import { batchCase, initialOutcomes, retainBatch } from './retain-batch';

export function useRetainBatch(files: File[], remainingFiles: File[], mode: 'existing' | 'create',
  caseId: string, name: string, onClose: () => void, routed: boolean) {
  const navigate = useNavigate();
  const [rows, setRows] = useState(() => initialOutcomes(files));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const created = useRef('');
  const inFlight = useRef(false);
  const acquiredAt = useRef(new Date().toISOString());
  const active = useRef<ReturnType<typeof createUploadCommand> | null>(null);
  useBeforeUnload(event => {
    if (!pending) return;
    event.preventDefault();
    event.returnValue = '';
  });
  const retain = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      const id = created.current || await batchCase(mode, caseId.trim(), name);
      created.current = id;
      const outcomes = await retainBatch(id, files, setRows, { acquiredAt: acquiredAt.current,
        active: command => { active.current = command; } });
      if (!routed) onClose();
      navigate(`/studio/work/cases/${id}/intake`, { replace: routed, state: { outcomes, remainingFiles } });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The batch could not be opened.');
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };
  const cancelUpload = async () => {
    try { await active.current?.cancel(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'The server did not answer.'); }
  };
  return { rows, pending, error, retain, retryUpload: () => active.current?.retry(), cancelUpload,
    created: Boolean(created.current),
    clearCreated: () => { created.current = ''; } };
}
