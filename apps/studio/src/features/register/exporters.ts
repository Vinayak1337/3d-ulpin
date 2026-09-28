import type { BuildingLedger, BuildingResidents } from '@ulpin/api-client/draft';
import { workbook, type Cell } from './workbook';
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

const OCCUPANCY: Record<string, string> = { owner_occupied: 'Owner-occupied', rented: 'Rented', vacant: 'Vacant' };
export const occupancyLabel = (v: string) => OCCUPANCY[v] ?? v;

interface RegisterRows {
  building: [string, Cell][];
  floors: Cell[][];
  units: Cell[][];
  holders: Cell[][];
  occupants: Cell[][];
}

/** The register as rows: building facts, floors, units, registered holders and occupants. */
export function registerRows(register: BuildingRegister, model: BuildingModel, ledger: BuildingLedger | null | undefined,
  residents: BuildingResidents | null | undefined, workflow: Map<string, SpaceWorkflow>): RegisterRows {
  const levels = new Map(model.levels.map((l) => [l.id, l]));
  const ground = ledger?.groundElevationM ?? model.levels.find((l) => !l.belowGround)?.lower ?? 0;
  const units = model.spaces.filter((s) => !s.parentId);
  const byUnit = new Map((residents?.units ?? []).map((u) => [u.spaceId, u]));
  const round = (v: number | null | undefined, d = 2) => (v === null || v === undefined ? null : Math.round(v * 10 ** d) / 10 ** d);
  const people = (residents?.units ?? []).reduce((n, u) => n + u.occupants.length, 0);
  return {
    building: [
      ['Building', register.property.name],
      ['Identifier', register.property.identifier],
      ['Address', ledger?.address ?? null],
      ['Parcel ULPIN', register.parcelIdentifiers.map((p) => p.value).join(', ') || ledger?.parcelUlpin || null],
      ['Area', register.area.name],
      ['Revision', register.property.revision],
      ['Levels', model.levels.length],
      ['Units', units.filter((s) => s.use === 'apartment' || !s.use).length],
      ['Registered residents', residents ? people : null],
      ['Share basis', ledger?.shareBasis ?? null],
      ['Shares total %', ledger?.shareTotalPct ?? null],
      ['Height datum', ledger?.siteDatum ?? null],
      ['Register extract as of', residents?.asOf ?? null],
      ['Registers', residents?.source ?? null],
      ['Exported', new Date().toISOString().slice(0, 16).replace('T', ' ')],
    ],
    floors: model.levels.map((l) => [
      l.label, l.record.use ?? null, round(l.lower === null ? null : l.lower - ground), round(l.upper === null ? null : l.upper - ground),
      round(l.lower), round(l.upper), units.filter((s) => s.levelId === l.id).length,
      (residents?.units ?? []).filter((u) => u.level === l.label).reduce((n, u) => n + u.occupants.length, 0),
    ]),
    units: units.map((s) => {
      const l = ledger?.spaces.find((x) => x.spaceId === s.id);
      const r = byUnit.get(s.id);
      return [
        s.levelId ? levels.get(s.levelId)?.label ?? null : null, s.name, s.record.identifier, workflow.get(s.id)?.code ?? null, s.use ?? null,
        l?.rights ?? 'unknown', round(l?.carpetAreaM2?.value), round(l?.declaredAreaM2?.value), round(l?.sharePct?.value, 3),
        r ? occupancyLabel(r.occupancy) : null, r ? r.holders.map((h) => h.name).join('; ') : null, r ? r.occupants.length : null,
        workflow.get(s.id)?.status ?? l?.status ?? 'draft',
      ];
    }),
    holders: (residents?.units ?? []).flatMap((u) => u.holders.map((h) => [u.level, u.unit, h.name, h.sharePct, h.deedNo, h.since])),
    occupants: (residents?.units ?? []).flatMap((u) => u.occupants.map((o) => [u.level, u.unit, o.name, o.relation, occupancyLabel(u.occupancy), o.since, o.registeredVia])),
  };
}

const FLOOR_HEADER = ['Level', 'Use', 'Bottom above ground (m)', 'Top above ground (m)', 'Bottom (datum m)', 'Top (datum m)', 'Units', 'Residents'];
const UNIT_HEADER = ['Level', 'Unit', 'Identifier', 'Proposed 3D ULPIN', 'Use', 'Rights', 'Carpet area (m²)', 'Declared area (m²)', 'Undivided share (%)', 'Occupancy', 'Registered holders', 'Residents', 'Status'];
const HOLDER_HEADER = ['Level', 'Unit', 'Registered holder', 'Share in unit (%)', 'Deed / registration no.', 'Holder since'];
const OCCUPANT_HEADER = ['Level', 'Unit', 'Name', 'Relation', 'Occupancy', 'Living here since', 'Registered through'];

/** The full register as an Excel workbook: one sheet each for the building, floors, units, holders and residents. */
export function registerWorkbook(rows: RegisterRows): Blob {
  return workbook([
    { name: 'Building', header: ['Field', 'Value'], rows: rows.building, widths: [26, 60] },
    { name: 'Floors', header: FLOOR_HEADER, rows: rows.floors },
    { name: 'Units', header: UNIT_HEADER, rows: rows.units },
    { name: 'Registered holders', header: HOLDER_HEADER, rows: rows.holders },
    { name: 'Residents', header: OCCUPANT_HEADER, rows: rows.occupants },
  ]);
}

const html = (v: Cell) => (v === null || v === undefined || v === '' ? '<span class="u">—</span>' : String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;'));
const table = (title: string, header: string[], rows: Cell[][]) => rows.length ? `<h2>${title}</h2><table><thead><tr>${header.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td${typeof c === 'number' ? ' class="n"' : ''}>${html(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>` : '';

/** The register as a printable document (A4 landscape), opened in a new window with the print dialog. */
export function printRegister(rows: RegisterRows, title: string) {
  const win = window.open('', '_blank');
  if (!win) return false;
  const byLevel = new Map<string, Cell[][]>();
  for (const o of rows.occupants) { const k = String(o[0]); byLevel.set(k, [...(byLevel.get(k) ?? []), o]); }
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${html(title)} · Register extract</title><style>
@page{size:A4 landscape;margin:14mm}body{font:10pt/1.4 "Noto Sans",system-ui,sans-serif;color:#1c2430;margin:0}
header{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #1f4e79;padding-bottom:8px;margin-bottom:12px}
h1{font-size:17pt;margin:0}h2{font-size:12pt;margin:18px 0 6px;color:#1f4e79;break-after:avoid}.meta{color:#5a6472;font-size:9pt;text-align:right}
dl{display:grid;grid-template-columns:repeat(4,max-content 1fr);gap:3px 12px;margin:0}dt{color:#5a6472}dd{margin:0;font-weight:600}
table{width:100%;border-collapse:collapse;font-size:8.5pt}th{background:#1f4e79;color:#fff;text-align:left;padding:4px 6px;font-weight:600}
td{padding:3px 6px;border-bottom:1px solid #dde2e8;vertical-align:top}tr:nth-child(even) td{background:#f5f7fa}td.n{text-align:right;font-variant-numeric:tabular-nums}.u{color:#9aa3ad}
thead{display:table-header-group}tr{break-inside:avoid}footer{margin-top:16px;color:#5a6472;font-size:8pt}
</style></head><body><header><div><div style="color:#5a6472;font-size:9pt">BhuAayam · Building register extract</div><h1>${html(title)}</h1></div>
<div class="meta">${html(rows.building.find(([k]) => k === 'Parcel ULPIN')?.[1])}<br>Exported ${html(rows.building.find(([k]) => k === 'Exported')?.[1])}</div></header>
<dl>${rows.building.filter(([k]) => !['Building', 'Exported'].includes(k)).map(([k, v]) => `<dt>${k}</dt><dd>${html(v)}</dd>`).join('')}</dl>
${table('Floors', FLOOR_HEADER, rows.floors)}${table('Units', UNIT_HEADER, rows.units)}${table('Registered holders', HOLDER_HEADER, rows.holders)}
${[...byLevel.entries()].map(([level, list]) => table(`Residents · ${level}`, OCCUPANT_HEADER, list)).join('')}
<footer>Personal details are for official use. Values not in the records are shown as —.</footer>
<script>window.onload=()=>setTimeout(()=>window.print(),200)</script></body></html>`);
  win.document.close();
  return true;
}
