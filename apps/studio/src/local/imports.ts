import type { BuildingImport, FileDetection } from '@ulpin/api-client/draft';
import { lake } from './sources';
import { floorsProgress, readSession, writeSession } from './session';
import { visibleLevelIds } from './story';

/**
 * Local answers for the building document endpoints: documents are recognised by format and content type and
 * stream in the building's levels.
 */
/** What a building document is, from its name and type. */
export function detect(name: string, bytes: number): FileDetection {
  const n = name.toLowerCase();
  const base = { name, bytes };
  if (n.endsWith('.pdf') && /plan/.test(n)) return { ...base, detected: 'Floor plan (PDF)', role: 'plan', contents: 'plan pages' };
  if (n.endsWith('.pdf') && /declaration/.test(n)) return { ...base, detected: 'Deed of declaration (PDF)', role: 'declaration', contents: 'shares schedule' };
  if (n.endsWith('.pdf') && /deed|sale/.test(n)) return { ...base, detected: 'Sale deed (PDF)', role: 'deed', contents: 'unit clauses' };
  if (/\.(csv|xlsx?)$/.test(n) && /level/.test(n)) return { ...base, detected: 'Level schedule', role: 'levels', contents: 'levels' };
  if (/\.(csv|xlsx?)$/.test(n) && /unit|inventory/.test(n)) return { ...base, detected: 'Unit inventory', role: 'units', contents: 'units' };
  if (/\.(las|laz)$/.test(n)) return { ...base, detected: 'Drone survey (LiDAR)', role: 'survey', contents: 'point cloud' };
  return { ...base, detected: n.endsWith('.pdf') ? 'Document (PDF)' : 'Other file', role: 'other', contents: 'kept as evidence' };
}

export function startFloorsImport(buildingId: string, files: string[]): BuildingImport {
  const id = crypto.randomUUID();
  writeSession({ floorsStartedAt: Date.now(), floorsImportId: id, floorsFiles: files });
  return buildingImport(id, buildingId)!;
}

export function buildingImport(id: string, buildingId = lake.register.property.id): BuildingImport | undefined {
  const s = readSession();
  if (s.floorsImportId !== id) return undefined;
  const p = floorsProgress();
  const levels = visibleLevelIds();
  const units = lake.register.register.filter((r) => r.use === 'apartment' && r.links.some((l) => levels.has(l.targetId))).length;
  const allLevels = lake.register.register.filter((r) => r.kind === 'floor').length;
  const at = (t: number) => (p >= t ? 'saved' : p >= t - 0.25 ? 'running' : 'queued') as 'saved' | 'running' | 'queued';
  const detail: Record<string, [number, string]> = {
    levels: [0.3, `${Math.min(levels.size, allLevels)} of ${allLevels} levels`],
    units: [0.6, `${units} units placed on their floors`],
    plan: [0.8, p >= 0.8 ? '3 pages · 6 room candidates on F7' : 'reading plan pages'],
    declaration: [0.9, p >= 0.9 ? 'Schedule B · shares for 48 units' : 'reading schedules'],
    deed: [0.95, p >= 0.95 ? 'Flat 704 · clause 2' : 'reading clauses'],
  };
  return {
    id, buildingId, state: p >= 1 ? 'done' : 'running', startedAt: new Date(s.floorsStartedAt!).toISOString(),
    levels: levels.size, units,
    files: s.floorsFiles.map((name) => {
      const d = detect(name, 0);
      const [t, text] = detail[d.role] ?? [1, 'kept as evidence'];
      return { name, detected: d.detected, state: at(t), detail: at(t) === 'queued' ? 'waiting' : text };
    }),
  };
}
