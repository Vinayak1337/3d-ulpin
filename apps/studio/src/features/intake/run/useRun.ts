import { useCallback, useState } from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { readConfirmation, readFirstReady, readNextRecorded } from './api';
import { acknowledgementWords, chooseReady, confirmablePackages, confirmationFacts,
  type Confirmation, type Readiness, type Target } from './model';
import { useConfirmationCommand } from './useConfirmationCommand';
import { useRunStream } from './useRunStream';
import { usePriority } from './usePriority';
import { runKey, useTargets } from './useTargets';
import { useConfirmationDiscovery } from './useConfirmationDiscovery';

export function useRun(caseId: string) {
  const cache = useQueryClient();
  const [filter, setFilter] = useState<Readiness | ''>('');
  const [choice, setChoice] = useState<Target[]>([]);
  const [editedAcknowledgement, setAcknowledgement] = useState<string | null>(null);
  const [storedIds, setStoredIds] = useState<string[]>([]);
  const [cards, setCards] = useState<Target[] | null>(null);
  const targets = useTargets(caseId, filter);
  const discovery = useConfirmationDiscovery(caseId, targets.summary.data?.items,
    targets.summary.data?.nextCursor ?? null);
  const ids = [...new Set([...discovery.ids, ...storedIds])];
  const confirmations = useStoredConfirmations(caseId, ids);
  const refresh = useCallback(() => {
    void cache.invalidateQueries({ queryKey: runKey(caseId) }, { cancelRefetch: false });
  }, [cache, caseId]);
  const stored = (confirmation: Confirmation) => {
    cache.setQueryData([...runKey(caseId), 'confirmation', confirmation.confirmationId], confirmation);
    setStoredIds(current => [...new Set([...current, confirmation.confirmationId])]);
    setChoice([]);
    setCards(null);
    setAcknowledgement(null);
    refresh();
  };
  const command = useConfirmationCommand(caseId, stored, () => { setChoice([]); setCards(null); refresh(); });
  const progress = confirmations.flatMap(query => query.data?.progress ?? []);
  useRunStream(caseId, progress, refresh);
  const preview = command.preview ?? targets.packagePage.data;
  const selected = currentChoice(preview, choice, command.preview ? [] : targets.targets);
  const facts = confirmationFacts(preview ? confirmablePackages(preview) : [], selected.length);
  const acknowledgement = editedAcknowledgement ?? (cards ? '' : acknowledgementWords(facts));
  const selection = useSelection(caseId, preview, selected, setChoice, targets.packageCursor);
  const turn = (move: () => void) => () => { setChoice([]); move(); };
  const priority = usePriority(caseId);
  const opening = useCardsOpening(caseId, setCards);
  return { targets, discovery, confirmations, confirmationKeys: ids,
    filter, setFilter, choice: selected, acknowledgement, setAcknowledgement,
    refresh, command, priority, ...selection, cards, closeCards: () => setCards(null), ...opening,
    nextPackages: turn(targets.nextPackages), firstPackages: turn(targets.firstPackages) };
}

/** Lists the next recorded buildings with no card on the confirmation screen; nothing is pressed for the officer. */
function useCardsOpening(caseId: string, setCards: (cards: Target[] | null) => void) {
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const openCards = async () => {
    if (opening) return;
    setOpening(true);
    setError(null);
    try {
      setCards(await readNextRecorded(caseId));
    } catch (failure) {
      setError(failure);
    } finally {
      setOpening(false);
    }
  };
  return { opening, cardsError: error, openCards };
}

function useStoredConfirmations(caseId: string, ids: string[]) {
  return useQueries({ queries: ids.map(confirmationId => ({
    queryKey: [...runKey(caseId), 'confirmation', confirmationId], retry: false,
    queryFn: () => readConfirmation(caseId, confirmationId),
  })) });
}

function currentChoice(page: ReturnType<typeof useTargets>['summary']['data'],
  choice: Target[], targets: readonly Target[]) {
  const known = new Map(targets.map(target => [target.targetId, target]));
  const candidates = choice.map(target => known.get(target.targetId) ?? target);
  return page ? chooseReady(candidates, confirmablePackages(page)) : [];
}

function useSelection(caseId: string, page: ReturnType<typeof useTargets>['summary']['data'],
  choice: Target[], setChoice: (choice: Target[]) => void, packageCursor: string | null) {
  const [choosing, setChoosing] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const packages = page ? confirmablePackages(page) : [];
  const selectable = (target: Target) => chooseReady([target], packages).length === 1;
  const toggle = (target: Target) => {
    if (choice.some(row => row.targetId === target.targetId)) {
      setChoice(choice.filter(row => row.targetId !== target.targetId));
    } else {
      setChoice(chooseReady([...choice, target], packages));
    }
  };
  const chooseFirst = async () => {
    if (choosing) return;
    setChoosing(true);
    setError(null);
    try {
      setChoice(await readFirstReady(caseId, packageCursor ?? undefined));
    } catch (failure) {
      setError(failure);
    } finally {
      setChoosing(false);
    }
  };
  return { choosing, selectionError: error, selectable, toggle, chooseFirst, clear: () => setChoice([]) };
}
