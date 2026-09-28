import type { BuildingLedger } from '@ulpin/api-client/draft';
import type { BuildingRegister } from '../../api/queries';
import type { BuildingModel, SpaceModel } from '../../model/building';
import type { SpaceWorkflow } from '../../local/workflow';

/** Hands the browser a file to save. */
export function download(name: string, body: string | Blob, type: string) {
  const url = URL.createObjectURL(typeof body === 'string' ? new Blob([body], { type }) : body);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const fileStem = (register: BuildingRegister) =>
  `${register.property.name.replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase()}-r${register.property.revision}`;

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** One row per unit, as the Units tab lists them. Unknown values stay empty, never zero. */
export function unitsCsv(model: BuildingModel, ledger: BuildingLedger | null | undefined, workflow: Map<string, SpaceWorkflow>): string {
  const levels = new Map(model.levels.map((l) => [l.id, l]));
  const header = ['level', 'unit', 'identifier', 'proposed_code', 'rights', 'carpet_m2', 'carpet_source', 'declared_m2', 'declared_source', 'share_pct', 'share_source', 'lower_m', 'upper_m', 'status'];
  const rows = model.spaces.filter((s) => !s.parentId).map((s) => {
    const l = ledger?.spaces.find((x) => x.spaceId === s.id);
    const wf = workflow.get(s.id);
    const src = (v: { source: string | null; locator: string | null } | null | undefined) => (v ? [v.source, v.locator].filter(Boolean).join(' ') : '');
    return [
      s.levelId ? levels.get(s.levelId)?.label : '', s.name, s.record.identifier, wf?.code ?? '', l?.rights ?? 'unknown',
      l?.carpetAreaM2?.value ?? '', src(l?.carpetAreaM2), l?.declaredAreaM2?.value ?? '', src(l?.declaredAreaM2),
      l?.sharePct?.value ?? '', src(l?.sharePct), s.lower ?? '', s.upper ?? '', wf?.status ?? l?.status ?? 'draft',
    ];
  });
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}

type Vertex = [number, number, number];

/**
 * CityJSON 2.0: the building, its storeys and units as LoD2 solids. Plan coordinates are the area's
 * local metres shifted back to the source CRS by its origin; heights are the site datum.
 */
export function cityJson(register: BuildingRegister, model: BuildingModel, ledger: BuildingLedger | null | undefined, workflow: Map<string, SpaceWorkflow>): string {
  const reference = (register.area as { reference?: { sourceCrs?: string; origin?: number[] } }).reference;
  const origin = reference?.origin ?? [0, 0];
  const epsg = /EPSG:(\d+)/.exec(reference?.sourceCrs ?? '')?.[1];
  const vertices: Vertex[] = [];
  const index = new Map<string, number>();
  const vertex = (x: number, y: number, z: number) => {
    const v: Vertex = [Math.round(x * 1000), Math.round(y * 1000), Math.round(z * 1000)];
    const key = v.join(',');
    let i = index.get(key);
    if (i === undefined) { i = vertices.length; vertices.push(v); index.set(key, i); }
    return i;
  };
  const solid = (ring: number[][], lower: number, upper: number) => {
    const pts = ring.slice(0, -1);
    const bottom = pts.map(([x, y]) => vertex(x!, y!, lower));
    const top = pts.map(([x, y]) => vertex(x!, y!, upper));
    const surfaces = [[[...bottom].reverse()], [top], ...pts.map((_, i) => {
      const j = (i + 1) % pts.length;
      return [[bottom[i]!, bottom[j]!, top[j]!, top[i]!]];
    })];
    return { type: 'Solid', lod: '2', boundaries: [surfaces] };
  };

  const objects: Record<string, unknown> = {};
  const buildingId = register.property.id;
  objects[buildingId] = {
    type: 'Building',
    attributes: {
      name: register.property.name, identifier: register.property.identifier, revision: register.property.revision,
      parcelUlpin: register.parcelIdentifiers.map((p) => p.value), address: ledger?.address ?? null, declaration: ledger?.declaration ?? null,
      shareBasis: ledger?.shareBasis ?? null, shareTotalPct: ledger?.shareTotalPct ?? null,
    },
    children: model.levels.map((l) => l.id),
  };
  for (const level of model.levels) {
    const spaces = model.spaces.filter((s) => s.levelId === level.id && !s.parentId);
    objects[level.id] = {
      type: 'BuildingStorey', parents: [buildingId], children: spaces.map((s) => s.id),
      attributes: { label: level.label, use: level.record.use ?? null, lowerM: level.lower, upperM: level.upper, estimated: level.estimated },
    };
    for (const space of spaces) objects[space.id] = unitObject(space, level.id, ledger, workflow, solid);
  }

  return JSON.stringify({
    type: 'CityJSON', version: '2.0',
    transform: { scale: [0.001, 0.001, 0.001], translate: [origin[0] ?? 0, origin[1] ?? 0, 0] },
    metadata: {
      title: `${register.property.name} r${register.property.revision}`,
      referenceDate: register.exportedAt?.slice(0, 10),
      ...(epsg ? { referenceSystem: `https://www.opengis.net/def/crs/EPSG/0/${epsg}` } : {}),
    },
    CityObjects: objects,
    vertices,
  });
}

function unitObject(space: SpaceModel, levelId: string, ledger: BuildingLedger | null | undefined, workflow: Map<string, SpaceWorkflow>,
  solid: (ring: number[][], lower: number, upper: number) => unknown) {
  const l = ledger?.spaces.find((x) => x.spaceId === space.id);
  const ring = space.polygons[0]?.[0];
  return {
    type: 'BuildingUnit', parents: [levelId],
    attributes: {
      name: space.name, identifier: space.record.identifier, use: space.use ?? null, rights: l?.rights ?? 'unknown',
      carpetAreaM2: l?.carpetAreaM2?.value ?? null, declaredAreaM2: l?.declaredAreaM2?.value ?? null, sharePct: l?.sharePct?.value ?? null,
      proposedCode: workflow.get(space.id)?.code ?? null,
      lowerVerified: space.record.geometry?.lowerVerified ?? null, upperVerified: space.record.geometry?.upperVerified ?? null,
    },
    geometry: ring && space.lower !== null && space.upper !== null ? [solid(ring as number[][], space.lower, space.upper)] : [],
  };
}

