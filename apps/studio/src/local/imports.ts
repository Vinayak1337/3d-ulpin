import type { BuildingImport, FileDetection } from '@ulpin/api-client/draft';
import { lake } from './sources';
import { areaProgress, floorsProgress, readSession, writeSession } from './session';
import { visibleFeatures, visibleLevelIds } from './story';

/**
 * Local answers for the upload endpoints. A GeoJSON area file is read for real (feature count, fields,
 * CRS member); the import then streams the area's records in (story.ts). Building documents are
 * recognised by format and content type and stream in the building's levels.
 */
const sha256 = async (bytes: ArrayBuffer) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function inspectAreaFile(file: File) {
  const bytes = await file.arrayBuffer();
  const lower = file.name.toLowerCase();
  const format = lower.endsWith('.gpkg') ? 'gpkg' : lower.endsWith('.zip') ? 'shapefile_zip' : 'geojson';
  let featureCount: number | null = null, sourceCrs: string | null = null, crsEvidence: string | null = null;
  let fieldNames: string[] = [], geometryTypes: string[] = [];
  const values = new Map<string, unknown[]>();
  if (format === 'geojson') {
    try {
      const doc = JSON.parse(new TextDecoder().decode(bytes)) as { features?: { properties?: Record<string, unknown>; geometry?: { type: string } }[]; crs?: { properties?: { name?: string } } };
      const features = doc.features ?? [];
      featureCount = features.length;
      geometryTypes = [...new Set(features.map((f) => f.geometry?.type).filter(Boolean) as string[])];
      for (const f of features) for (const [k, v] of Object.entries(f.properties ?? {})) { if (!values.has(k)) values.set(k, []); values.get(k)!.push(v); }
      fieldNames = [...values.keys()];
      const named = doc.crs?.properties?.name;
      sourceCrs = named ? (/EPSG::?(\d+)/.exec(named) ? `EPSG:${/EPSG::?(\d+)/.exec(named)![1]}` : named) : 'EPSG:4326';
      crsEvidence = named ? `crs member: ${named}` : 'GeoJSON default (RFC 7946)';
    } catch { /* not JSON: reported with no features */ }
  }
  const fields = fieldNames.map((name) => {
    const v = values.get(name) ?? [];
    const complete = featureCount !== null && v.length === featureCount && v.every((x) => x !== null && x !== '');
    const unique = new Set(v.map(String)).size === v.length;
    return { name, complete, unique, idEligible: complete && unique };
  });
  return {
    format, sourceSha256: await sha256(bytes), bytes: bytes.byteLength, layers: [], layer: null, sourceCrs, crsEvidence, featureCount, geometryTypes, fields,
    featureIdEligible: false, suggestedIdField: fields.find((f) => f.idEligible && /id/i.test(f.name))?.name ?? fields.find((f) => f.idEligible)?.name ?? null,
    suggestedNameField: fields.find((f) => /name/i.test(f.name))?.name ?? null,
    suggestedTitle: file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '), suggestedNamespace: 'lake-view-survey',
  };
}

export function startAreaImport(name: string) {
  const id = crypto.randomUUID();
  writeSession({ areaStartedAt: Date.now(), areaPackageId: id });
  return areaPackage(id, name);
}

export function areaPackage(id: string, name = 'lake_view_survey.geojson') {
  if (readSession().areaPackageId !== id) return undefined;
  const p = areaProgress();
  const parcels = lake.register.sources.find((s) => s.name === 'parcels.gpkg')!;
  return {
    id, schemaVersion: 'ulpin-canonical/2', areaId: lake.context.area.id, name, datasetNamespace: 'lake-view-survey', revision: 1,
    state: p >= 1 ? 'READY_FOR_REVIEW' : 'RECEIVED', sourceRevisionIds: [parcels.id], features: visibleFeatures(),
    questions: [], factCandidates: [], parts: [], warnings: [], createdAt: new Date(readSession().areaStartedAt ?? Date.now()).toISOString(),
  };
}

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
