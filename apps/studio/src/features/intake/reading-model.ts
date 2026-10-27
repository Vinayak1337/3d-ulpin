import { useEffect, useRef } from 'react';
import { skipToken, useQuery } from '@tanstack/react-query';
import type { GetResponse } from '@ulpin/api-client';
import type { IntakeManifest } from './batch-model';
import { intakeKey, readIntakeReading } from './batch-queries';

export type Reading = GetResponse<'/api/v1/ingestion/cases/{caseId}/intake/items/{itemId}/reading'>;
export const readingKey = (caseId: string, itemId: string) => [...intakeKey(caseId), itemId, 'reading'];

export function useReading(caseId: string, itemId: string) {
  const manifest = useQuery<IntakeManifest>({ queryKey: intakeKey(caseId), queryFn: skipToken });
  const item = manifest.data?.items.find(row => row.itemId === itemId);
  const query = useQuery({ queryKey: readingKey(caseId, itemId), enabled: Boolean(item?.sourceId),
    retry: false, staleTime: 0, queryFn: () => readIntakeReading(caseId, itemId) });
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
