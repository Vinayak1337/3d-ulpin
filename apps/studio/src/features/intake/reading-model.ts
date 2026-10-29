import { useEffect, useRef } from 'react';
import { queryOptions, useQuery } from '@tanstack/react-query';
import type { GetResponse } from '@ulpin/api-client';
import { intakeManifestOptions, intakeKey, readIntakeReading } from './batch-queries';

export type Reading = GetResponse<'/api/v1/ingestion/cases/{caseId}/intake/items/{itemId}/reading'>;
export const readingKey = (caseId: string, itemId: string) => [...intakeKey(caseId), itemId, 'reading'];

/** Cache-only observers keep the same fetcher, so a tray render cannot replace a live read with skipToken. */
export function readingOptions(caseId: string, itemId: string) {
  return queryOptions({ queryKey: readingKey(caseId, itemId), retry: false, staleTime: 0,
    queryFn: () => readIntakeReading(caseId, itemId) });
}

export function useReading(caseId: string, itemId: string) {
  const manifest = useQuery({ ...intakeManifestOptions(caseId), enabled: false });
  const item = manifest.data?.items.find(row => row.itemId === itemId);
  const query = useQuery({ ...readingOptions(caseId, itemId), enabled: Boolean(item?.sourceId) });
  const previous = useRef(item?.updatedAt);
  useEffect(() => {
    if (previous.current !== item?.updatedAt && item?.sourceId) void query.refetch();
    previous.current = item?.updatedAt;
  }, [item?.updatedAt, item?.sourceId, query.refetch]);
  return query;
}

export function basisWords(basis: Reading['what']['basis']) {
  const words = { reader: 'read from the file', memory: 'from memory', rule: 'from a rule',
    sarvam: 'from Sarvam, not confirmed', officer: 'confirmed by you' };
  return words[basis];
}
