import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SceneEngine, SurfacePartInput } from '@ulpin/scene';
import type { Area } from '../../../api/queries';
import { caseSubscriptions } from '../../intake/case-subscription';
import { itemRefreshFor } from '../../intake/item-refresh';
import { browserSurfaceIo, intakeQuery, readCases, SurfaceDecoder } from './api';
import { isSurfaceItem, SurfaceParts, type IntakeItem, type SurfaceLine } from './parts';

const SETTLED = new Set(['read', 'read_to_limit', 'failed_part']);
const NO_ITEMS: IntakeItem[] = [];
const partItem = (part: SurfacePartInput) => part.id.split(':')[0]!;

/**
 * The read parts of the kept orthophotos, terrain rasters and point clouds of the area's batches (the cases of its
 * site, and the batch the map was opened from), drawn on the map for display only: only the parts placed in this
 * area, since a far file is placed in its own (S9.4d). The batch stream reads the items again when it reports a change, so
 * new parts appear without a reload. Each file's line can switch its parts off.
 *
 * SL1. A change goes to the batch's one shared refresh (TR1), the tray's own: a change naming an item the cache
 * holds reads that item alone, and the tray and the map together read it once; any other change reads the manifest.
 */
export function useSurfaceLayer(area: Pick<Area, 'id' | 'siteId'> | undefined, engine: SceneEngine | null,
  caseId: string | null = null) {
  const siteId = area?.siteId;
  const cases = useQuery({ queryKey: ['cases'], enabled: Boolean(siteId), staleTime: 60_000,
    queryFn: ({ signal }) => readCases(signal) });
  const caseIds = useMemo(() => (cases.data ?? [])
    .filter((item) => (item.siteId === siteId || item.id === caseId) && !item.archived).map((item) => item.id),
  [cases.data, siteId, caseId]);
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
      refresh: (itemId) => itemRefreshFor(client, caseId).changed(itemId),
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
    const parts = new SurfaceParts(browserSurfaceIo(decoder), (drawn, lines) => setView({ parts: drawn, lines }),
      area?.id ?? null);
    setReader(parts);
    return () => { parts.dispose(); decoder.dispose(); };
  }, [area?.id]);
  useEffect(() => { reader?.sync(items); }, [reader, items]);

  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const shown = useMemo(() => view.parts.filter((part) => !hidden.has(partItem(part))), [view.parts, hidden]);
  useEffect(() => { engine?.setSurfaceParts(shown); }, [engine, shown]);
  // The files with a part handed to the scene, space separated, for a page attribute only: no words on screen.
  const drawn = useMemo(() => (engine ? [...new Set(shown.map(partItem))].join(' ') : ''), [engine, shown]);
  const show = (itemId: string, on: boolean) => setHidden((now) => {
    const next = new Set(now);
    if (on) next.delete(itemId); else next.add(itemId);
    return next;
  });
  return { lines: view.lines.map((line) => ({ ...line, checked: !hidden.has(line.itemId) })), show, items, drawn };
}
