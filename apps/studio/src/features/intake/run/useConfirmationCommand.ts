import { useRef, useState } from 'react';
import { ApiError } from '@ulpin/api-client';
import { sendConfirmation, failureWords } from './api';
import { cardsBody, confirmBody, type Confirmation, type ConfirmBody, type Target, type TargetPage } from './model';

export function useConfirmationCommand(caseId: string, stored: (confirmation: Confirmation) => void,
  moved: () => void) {
  const pending = useRef<ConfirmBody | null>(null);
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<TargetPage | null>(null);
  // An uncertain outcome sends the same body again, with its request key, until the server answers.
  const send = async (make: (requestKey: string) => ConfirmBody, page: TargetPage | null) => {
    if (inFlight.current) return;
    const body = pending.current ?? make(crypto.randomUUID());
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
  const press = (page: TargetPage, choice: readonly Target[], acknowledgement: string, cardsOnly = false) =>
    send(requestKey => confirmBody(page, choice, acknowledgement, requestKey, cardsOnly), page);
  /** Cards only, for recorded buildings named outside the batch page: no page is previewed. */
  const pressCards = (choice: readonly Target[], acknowledgement: string) =>
    send(requestKey => cardsBody(choice, acknowledgement, requestKey), null);
  return { press, pressCards, busy, uncertain, error, preview };
}
