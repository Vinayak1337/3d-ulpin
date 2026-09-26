import { areaProgress, floorsProgress, isDeleted, readSession } from './session';
import { buildingCode } from './codes';
import { lake } from './sources';

/**
 * Lake View as the imports have delivered it so far (see session.ts). Before the area survey is imported
 * nothing exists; while it streams, features arrive from the residence outwards; the residence has no
 * floors until its documents are imported, then its levels stack from the lowest up.
 */
type Json = Record<string, unknown>;
type Feature = (typeof lake.context.features)[number];
const RESIDENCE = lake.register.property.id;
const AREA_ID = lake.context.area.id;

const centre = (f: Feature) => {
  const ring = ((f.geometry as { coordinates: number[][][] }).coordinates[0] ?? []) as number[][];
  const xs = ring.map((p) => p[0]!), ys = ring.map((p) => p[1]!);
  return Math.hypot((Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2);
};

/** When each feature arrives in the area stream (0..1): base map first, then buildings outwards, utilities last. */
const ARRIVAL = (() => {
  const out = new Map<string, number>();
  const band = (kinds: string[], from: number, to: number) => {
    const list = lake.context.features.filter((f) => kinds.includes(f.kind)).sort((a, b) => centre(a) - centre(b));
    list.forEach((f, i) => out.set(f.id, from + ((to - from) * i) / Math.max(1, list.length)));
  };
  band(['road', 'public_land'], 0.02, 0.18);
  band(['parcel'], 0.08, 0.35);
  band(['building'], 0.3, 0.92);
  band(['utility'], 0.94, 0.97);
  return out;
})();

export const areaStarted = () => readSession().areaStartedAt !== null;
export const floorsStarted = () => readSession().floorsStartedAt !== null && !isDeleted(RESIDENCE);
export const floorsDone = () => floorsStarted() && floorsProgress() >= 1;

/** Every building carries the proposed 3D ULPIN allotted when the import committed it. */
const withCode = (f: Feature): Feature => (f.kind === 'building' ? { ...f, projectCode: buildingCode(f.id) } as unknown as Feature : f);

export function visibleFeatures(): Feature[] {
  const p = areaProgress();
  return lake.context.features.filter((f) => (ARRIVAL.get(f.id) ?? 1) <= p && !isDeleted(f.id)).map(withCode);
}

/** A building that exists in this deployment now: imported and not deleted. */
export const buildingVisible = (id: string) => visibleFeatures().some((f) => f.id === id && f.kind === 'building');

export function storyAreas(): Json[] | null {
  if (!areaStarted()) return [];
  return [{ ...(lake.context.area as Json), featureCount: visibleFeatures().length }];
}

export function storyContext(areaId: string): Json | undefined {
  if (areaId !== AREA_ID || !areaStarted()) return undefined;
  const features = visibleFeatures();
  return { ...(lake.context as unknown as Json), area: { ...(lake.context.area as Json), featureCount: features.length }, features };
}

// ------------------------------------------------------------------ floors
type Rec = (typeof lake.register.register)[number];
const levels = lake.register.register.filter((r) => r.kind === 'floor');
/** Lowest level first: B2, B1, G, F1 … F8, Roof. */
const BOTTOM_UP = [...levels].sort((a, b) => (a.geometry?.lower ?? 0) - (b.geometry?.lower ?? 0));
const levelOf = (r: Rec) => r.kind === 'floor' ? r.id : r.links.find((l) => l.type === 'floor')?.targetId;

export function visibleLevelIds(): Set<string> {
  const p = floorsProgress();
  return new Set(BOTTOM_UP.filter((_, i) => 0.05 + (0.85 * i) / BOTTOM_UP.length <= p).map((l) => l.id));
}

export function storyRegister(buildingId: string, body: Json): Json {
  if (buildingId !== RESIDENCE) return body;
  const reg = body as unknown as typeof lake.register;
  if (!floorsStarted()) {
    return {
      ...body, register: [], findings: [], sources: reg.sources.filter((s) => s.name === 'parcels.gpkg'),
      missing: ['No floors or spaces are recorded for this building yet. Add its plans and level schedule.'],
      findingQualification: { state: 'not_assessed', missing: [] },
    };
  }
  const shown = visibleLevelIds();
  const done = floorsDone();
  return {
    ...body,
    register: reg.register.filter((r) => shown.has(levelOf(r) ?? '')),
    findings: done ? reg.findings : [],
    findingQualification: done ? reg.findingQualification : { state: 'not_assessed', missing: [] },
  };
}

export function storyLedger(body: Json): Json | undefined {
  if (!floorsStarted()) return undefined;
  if (floorsDone()) return body;
  return { ...body, checks: [], findingDetails: [], deviation: null };
}

// ------------------------------------------------------------------ work queue and board
export function storyQueueItems(items: Json[]): Json[] {
  if (!areaStarted()) return [];
  const area = {
    ...items[0]!, id: readSession().areaPackageId ?? items[0]!.id, name: 'lake_view_survey.geojson', kind: 'import', buildingId: null, sourceCount: 1,
    state: areaProgress() >= 1 ? 'COMMITTED' : 'RECEIVED', jobStatus: areaProgress() >= 1 ? null : 'running',
    recordedHistory: areaProgress() >= 1, currentRecorded: areaProgress() >= 1,
    updatedAt: new Date(readSession().areaStartedAt!).toISOString(),
  };
  if (!floorsDone()) return [area];
  // Cases opened by the floor import, stamped from when it ran.
  const start = readSession().floorsStartedAt!;
  const cases = items.filter((i) => i.kind === 'case').map((i, k) => ({ ...i, updatedAt: new Date(start + 10_000 + k * 1000).toISOString() }));
  return [...cases, area];
}

export function storyBoard(board: Json & { items: Json[]; counts: Json[] }, queue: Json[]): Json {
  const ids = new Set(queue.map((q) => q.id));
  const areaItem = queue.find((q) => q.name === 'lake_view_survey.geojson');
  const items = board.items.filter((i) => ids.has(i.id));
  if (areaItem) {
    const done = areaProgress() >= 1;
    items.push({
      id: areaItem.id, stage: done ? 'recorded' : 'add_files', detail: `${visibleFeatures().length} features`,
      nextAction: { label: done ? 'Open the map' : 'Importing…', target: { kind: 'area', areaId: AREA_ID } },
      readiness: { met: done ? 6 : Math.round(areaProgress() * 6), unknown: 0, of: 6 },
    });
  }
  return { ...board, items, counts: floorsDone() ? board.counts.filter((c) => c.key !== 'imports_running') : [] };
}
