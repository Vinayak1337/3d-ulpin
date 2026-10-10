import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { generateCard, queryKeys, type ListedCard, type UnitCards } from '../../api/queries';
import type { AssignSubject } from './assignment';
import { cardKey, generateBody, issueFailure, storedRow, type IssueTarget } from './issue';
import {
  prepareFirstCard, prepareRevision, type Answered, type Prepared, type PrepareSession, type Typed,
} from './prepare';
import { readFailure } from './registryCard';

interface IssueUnit { buildingId: string; unitId: string }
type Issued = { cardId: string; revision: number } | null;

/** Reads the record and the cards of the unit again and answers the rows the registry lists now. */
function useCardsReadAgain({ buildingId, unitId }: IssueUnit) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (asked: { issued: Issued; prepared: boolean }) => {
      // The card of a new plan is listed under a snapshot that the last read of the snapshots did not hold.
      await client.invalidateQueries({ queryKey: queryKeys.buildingSnapshots(buildingId) });
      await client.refetchQueries({ queryKey: queryKeys.buildingCanonical(buildingId) }, { throwOnError: true });
      const cards = queryKeys.unitCards(buildingId, unitId);
      await client.refetchQueries({ queryKey: cards }, { throwOnError: true });
      return { ...asked, cards: client.getQueryData<UnitCards>(cards)?.cards ?? [] };
    },
  });
}

/**
 * Prepare and the card request of one unit, as one dialog session holds them. Each click sends its requests
 * once. After an outcome that is unknown nothing more is sent until the record and its cards were read again.
 */
export function useIssueFlow(
  unit: IssueUnit, target: IssueTarget, listed: readonly ListedCard[], onListed: () => void,
) {
  const [answered, setAnswered] = useState<Answered>({});
  const [stopped, setStopped] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [mustRead, setMustRead] = useState(false);
  // The row a read found after the answer of the card request was lost: the card exists.
  const [found, setFound] = useState<ListedCard | null>(null);
  // A read after a lost answer listed no new row: the same card request may go again, with the same key.
  const [again, setAgain] = useState(false);
  const known = useRef(new Set(listed.map(cardKey)));
  const session = useRef<PrepareSession>({ captured: null });
  // One key per prepared card: after a read that lists no new row, the same body goes with the same key.
  const key = useRef('');
  const onError = (error: unknown) => setMustRead(issueFailure(error).unknown);

  const prepare = useMutation({
    mutationFn: ({ subject, typed }: { subject: AssignSubject; typed: Typed }) => {
      setAnswered({});
      setStopped(null);
      if (target.mode === 'update') return prepareRevision(target, typed.expiresAt);
      const report = (more: Answered) => setAnswered((before) => ({ ...before, ...more }));
      return prepareFirstCard(subject, typed, session.current, report);
    },
    onSuccess: (result) => {
      if (typeof result === 'string') return setStopped(result);
      key.current = crypto.randomUUID();
      return setPrepared(result);
    },
    onError,
  });
  const issue = useMutation({
    mutationFn: (from: Prepared) => generateCard(generateBody(from.request, key.current)),
    onError,
  });
  const read = useCardsReadAgain(unit);

  const readAgain = (issued: Issued) => read.mutate({ issued, prepared: prepared !== null }, {
    onSuccess: (now) => {
      const row = now.prepared ? storedRow(now.cards, known.current, now.issued) : null;
      if (row && now.issued) return onListed();
      setFound(row);
      setMustRead(false);
      setAgain(now.prepared && !row && !now.issued);
      if (!now.issued) issue.reset();
      return prepare.reset();
    },
  });
  const error = issue.error ?? prepare.error;
  return {
    answered, stopped, prepared, mustRead, found, again, prepare, issue,
    issueCard: (from: Prepared) => { setAgain(false); issue.mutate(from, { onSuccess: readAgain }); },
    readAgain: () => readAgain(issue.data ?? null),
    busy: prepare.isPending || issue.isPending || read.isPending,
    failure: error ? issueFailure(error) : null,
    readError: read.error ? `The record could not be read again. ${readFailure(read.error)}` : null,
    /** After a refused card request the officer may change what was typed and prepare again. */
    prepareAgain: () => { setPrepared(null); setAnswered({}); setAgain(false); issue.reset(); prepare.reset(); },
  };
}

export type IssueFlow = ReturnType<typeof useIssueFlow>;
