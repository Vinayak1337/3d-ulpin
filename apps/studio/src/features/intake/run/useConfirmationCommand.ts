import { useRef, useState } from 'react';
import { ApiError } from '@ulpin/api-client';
import { sendConfirmation, failureWords } from './api';
import { confirmBody, type Confirmation, type ConfirmBody, type Target, type TargetPage } from './model';

export function useConfirmationCommand(caseId: string, stored: (confirmation: Confirmation) => void,
  moved: () => void) {
  const pending = useRef<ConfirmBody | null>(null);
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<TargetPage | null>(null);
  const press = async (page: TargetPage, choice: readonly Target[], acknowledgement: string, cardsOnly = false) => {
    if (inFlight.current) return;
    const body = pending.current ?? confirmBody(page, choice, acknowledgement, crypto.randomUUID(), cardsOnly);
    if (!pending.current) setPreview(page);
    pending.current = body;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      const confirmation = await sendConfirmation(caseId, body);
      pending.current = null;
      setPreview(null);
      setUncertain(false);
      stored(confirmation);
    } catch (failure) {
      setError(failureWords(failure));
      if (failure instanceof ApiError && failure.status < 500) {
        pending.current = null;
        setPreview(null);
        setUncertain(false);
        if (failure.status === 409) moved();
      } else {
        setUncertain(true);
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  return { press, busy, uncertain, error, preview };
}
