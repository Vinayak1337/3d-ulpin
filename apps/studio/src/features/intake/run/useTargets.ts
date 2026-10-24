import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { readTargets } from './api';
import type { Readiness, Target } from './model';

export const runKey = (caseId: string) => ['intake-run', caseId];

export function useTargets(caseId: string, filter: Readiness | '') {
  const summary = useQuery({ queryKey: [...runKey(caseId), 'summary'], retry: false,
    queryFn: () => readTargets(caseId) });
  const first = useQuery({ queryKey: filter ? [...runKey(caseId), 'list', filter] : [...runKey(caseId), 'summary'],
    retry: false,
    queryFn: () => readTargets(caseId, filter || undefined) });
  const [packageCursor, setPackageCursor] = useState<string | null>(null);
  const later = useQuery({ queryKey: [...runKey(caseId), 'packages', packageCursor], retry: false,
    enabled: packageCursor !== null, queryFn: () => readTargets(caseId, undefined, undefined, packageCursor!) });
  const packagePage = packageCursor === null ? summary : later;
  const generation = useRef(0);
  const [extra, setExtra] = useState<Target[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    generation.current++;
    setExtra([]);
    setCursor(first.data?.nextCursor ?? null);
    setError(null);
  }, [first.data, filter]);
  const showMore = async () => {
    if (!cursor || busy) return;
    setBusy(true);
    const version = generation.current;
    try {
      const page = await readTargets(caseId, filter || undefined, cursor);
      if (version !== generation.current) return;
      setExtra(rows => [...rows, ...page.items]);
      setCursor(page.nextCursor);
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  };
  const nextPackages = () => setPackageCursor(packagePage.data?.packagesNextCursor ?? packageCursor);
  return { summary, first, targets: [...(first.data?.items ?? []), ...extra], cursor, busy, error, showMore,
    packagePage, packageCursor, nextPackages, firstPackages: () => setPackageCursor(null) };
}
