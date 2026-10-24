import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SceneEngine, SurfacePartInput } from '@ulpin/scene';
import { caseSubscriptions } from '../../intake/case-subscription';
import { browserSurfaceIo, intakeQuery, readCases, SurfaceDecoder } from './api';
import { isSurfaceItem, SurfaceParts, type IntakeItem, type SurfaceLine } from './parts';

const SETTLED = new Set(['read', 'read_to_limit', 'failed_part']);
const NO_ITEMS: IntakeItem[] = [];

/**
 * The read parts of the kept orthophotos, terrain rasters and point clouds of the area's batches (the cases of its
 * site), drawn on the map for display only. The batch stream reads the items again when it reports a change, so
 * new parts appear without a reload. Each file's line can switch its parts off.
 */
export function useSurfaceLayer(siteId: string | undefined, engine: SceneEngine | null) {
  const cases = useQuery({ queryKey: ['cases'], enabled: Boolean(siteId), staleTime: 60_000,
    queryFn: ({ signal }) => readCases(signal) });
  const caseIds = useMemo(() => (cases.data ?? [])
    .filter((item) => item.siteId === siteId && !item.archived).map((item) => item.id), [cases.data, siteId]);
  const manifests = useQueries({ queries: caseIds.map(intakeQuery) });
  const stamp = manifests.map((manifest) => manifest.dataUpdatedAt).join();
  // A new answer of any batch is a new item list; an unchanged one keeps the same list.
  const items = useMemo(() => manifests.flatMap((manifest) => manifest.data?.items ?? NO_ITEMS), [stamp]);
  const unsettled = useRef(false);
  unsettled.current = items.some((item) => isSurfaceItem(item) && !SETTLED.has(item.state));

  const client = useQueryClient();
  const casesKey = caseIds.join();
  useEffect(() => {
    const stops = caseIds.map((caseId) => caseSubscriptions.subscribe(caseId, {
      refresh: () => { void client.invalidateQueries({ queryKey: ['intake', caseId] }); },
      unsettled: () => unsettled.current,
      status: () => {},
    }));
    return () => stops.forEach((stop) => stop());
    // The case ids are compared by value: the same batches keep their subscriptions.
  }, [casesKey, client]);

  const [view, setView] = useState<{ parts: SurfacePartInput[]; lines: SurfaceLine[] }>({ parts: [], lines: [] });
  const [reader, setReader] = useState<SurfaceParts | null>(null);
  useEffect(() => {
    const decoder = new SurfaceDecoder();
    const parts = new SurfaceParts(browserSurfaceIo(decoder), (drawn, lines) => setView({ parts: drawn, lines }));
    setReader(parts);
    return () => { parts.dispose(); decoder.dispose(); };
  }, []);
  useEffect(() => { reader?.sync(items); }, [reader, items]);

  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    engine?.setSurfaceParts(view.parts.filter((part) => !hidden.has(part.id.split(':')[0]!)));
  }, [engine, view.parts, hidden]);
  const show = (itemId: string, on: boolean) => setHidden((now) => {
    const next = new Set(now);
    if (on) next.delete(itemId); else next.add(itemId);
    return next;
  });
  return { lines: view.lines.map((line) => ({ ...line, checked: !hidden.has(line.itemId) })), show };
}
