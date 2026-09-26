import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ApiError } from '@ulpin/api-client';
import type { PublicBuilding, PublicMap, PublicRecord, PublicSearch } from '@ulpin/api-client/draft';

/** Public portal reads: released facts only (PUBLIC-01). A 404 means "not released" and resolves to null. */
async function getPublic<T>(path: string): Promise<T | null> {
  const response = await globalThis.fetch(path, { headers: { accept: 'application/json' } });
  if (response.status === 404) return null;
  if (!response.ok) throw new ApiError(response.status, path, await response.json().catch(() => null));
  return (await response.json()) as T;
}

export const publicKeys = { all: ['public'] as const };

export function usePublicSearch(q: string) {
  return useQuery({
    queryKey: ['public', 'search', q], enabled: q.trim().length > 0, placeholderData: keepPreviousData,
    queryFn: () => getPublic<PublicSearch>(`/api/v1/public/records?q=${encodeURIComponent(q)}`),
  });
}

export function usePublicRecord(id: string | undefined) {
  return useQuery({ queryKey: ['public', 'record', id], enabled: Boolean(id), queryFn: () => getPublic<PublicRecord>(`/api/v1/public/records/${id}`) });
}

export function usePublicBuilding(id: string | null | undefined) {
  return useQuery({ queryKey: ['public', 'building', id], enabled: Boolean(id), queryFn: () => getPublic<PublicBuilding>(`/api/v1/public/buildings/${id}`), refetchInterval: 3000 });
}

export function usePublicAreas() {
  return useQuery({ queryKey: ['public', 'areas'], queryFn: () => getPublic<Array<{ id: string; name: string; records: number }>>('/api/v1/public/areas'), refetchInterval: 3000 });
}

export function usePublicMap(areaId: string | null | undefined) {
  return useQuery({ queryKey: ['public', 'map', areaId], enabled: Boolean(areaId), queryFn: () => getPublic<PublicMap>(`/api/v1/public/areas/${areaId}/map`), refetchInterval: 3000 });
}
