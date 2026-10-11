import { useCallback, useState } from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { readConfirmation, readFirstReady } from './api';
import { chooseReady, confirmablePackages, type Confirmation, type Readiness, type Target } from './model';
import { useConfirmationCommand } from './useConfirmationCommand';
import { useRunStream } from './useRunStream';
import { usePriority } from './usePriority';
import { runKey, useTargets } from './useTargets';
import { useConfirmationDiscovery } from './useConfirmationDiscovery';

export function useRun(caseId: string) {
  const cache = useQueryClient();
  const [filter, setFilter] = useState<Readiness | ''>('');
  const [choice, setChoice] = useState<Target[]>([]);
  const [acknowledgement, setAcknowledgement] = useState('');
  const [storedIds, setStoredIds] = useState<string[]>([]);
  const targets = useTargets(caseId, filter);
  const discovery = useConfirmationDiscovery(caseId, targets.summary.data?.items,
    targets.summary.data?.nextCursor ?? null);
  const ids = [...new Set([...discovery.ids, ...storedIds])];
  const confirmations = useQueries({ queries: ids.map(confirmationId => ({
    queryKey: [...runKey(caseId), 'confirmation', confirmationId], retry: false,
    queryFn: () => readConfirmation(caseId, confirmationId),
  })) });
  const refresh = useCallback(() => {
    void cache.invalidateQueries({ queryKey: runKey(caseId) }, { cancelRefetch: false });
  }, [cache, caseId]);
  const stored = (confirmation: Confirmation) => {
    cache.setQueryData([...runKey(caseId), 'confirmation', confirmation.confirmationId], confirmation);
    setStoredIds(current => [...new Set([...current, confirmation.confirmationId])]);
    setChoice([]);
    setAcknowledgement('');
    refresh();
  };
  const command = useConfirmationCommand(caseId, stored, () => { setChoice([]); refresh(); });
  const progress = confirmations.flatMap(query => query.data?.progress ?? []);
  useRunStream(caseId, progress, refresh);
  const selection = useSelection(caseId, targets.summary.data, choice, setChoice);
  const priority = usePriority(caseId);
  return { targets, discovery, confirmations, confirmationKeys: ids,
    filter, setFilter, choice, acknowledgement, setAcknowledgement,
    refresh, command, priority, ...selection };
}

function useSelection(caseId: string, page: ReturnType<typeof useTargets>['summary']['data'],
  choice: Target[], setChoice: (choice: Target[]) => void) {
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
      setChoice(await readFirstReady(caseId));
    } catch (failure) {
      setError(failure);
    } finally {
      setChoosing(false);
    }
  };
  return { choosing, selectionError: error, selectable, toggle, chooseFirst, clear: () => setChoice([]) };
}
