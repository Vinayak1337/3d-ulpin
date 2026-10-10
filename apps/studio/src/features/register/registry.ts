import type { ConsolidatedRegistryReport } from '../../../../../packages/contracts/src/building-registry-report';
import type { BuildingLedger, BuildingResidents } from '@ulpin/api-client/draft';
import type { BuildingModel } from '../../model/building';
import type { SpaceWorkflow } from '../../local/workflow';
import { readingStatement } from './registerState';
import { IDENTIFIER_HEADERS, identifierColumns } from './buildingColumns';
import { workbook, zip, type Cell } from './workbook';

/**
 * Registry exports built on the consolidated report (`building-registry-summary/1`): a readable register
 * document, and a data package (the report JSON, one CSV per table, an Excel workbook, CityJSON and a
 * manifest with SHA-256 per file). Measurements, codes and deed references come from the register and
 * ledger beside it; each row carries the record UUID and application ID so tables join.
 */
type Report = ConsolidatedRegistryReport;
type Field = Report['building']['name'];

export interface RegistryDetail {
  buildingCode: string | null;
  address: string | null;
  datum: string | null;
  shareBasis: string | null;
  shareTotalPct: number | null;
  asOf: string | null;
  registers: string | null;
  floors: Map<string, { label: string; use: string | null; bottom: number | null; top: number | null; ground: number }>;
  units: Map<string, {
    level: string | null; use: string | null; rights: string; carpetM2: number | null; declaredM2: number | null; sharePct: number | null;
    code: string | null; status: string; occupancy: string | null;
    holders: { name: string; sharePct: number; deedNo: string; since: string }[];
    occupants: { name: string; relation: string; since: string; registeredVia: string }[];
  }>;
}

const OCCUPANCY: Record<string, string> = { owner_occupied: 'Owner-occupied', rented: 'Rented', vacant: 'Vacant' };

export function registryDetail(model: BuildingModel, ledger: BuildingLedger | null | undefined, residents: BuildingResidents | null | undefined,
  workflow: Map<string, SpaceWorkflow>, buildingCode: string | null): RegistryDetail {
  const ground = ledger?.groundElevationM ?? model.levels.find((l) => !l.belowGround)?.lower ?? 0;
  const byUnit = new Map((residents?.units ?? []).map((u) => [u.spaceId, u]));
  const levelLabel = new Map(model.levels.map((l) => [l.id, l.label]));
  const address = [residents?.address.line ?? ledger?.address, residents?.address.locality, residents?.address.district, residents?.address.region, residents?.address.postalCode, residents?.address.country].filter(Boolean).join(', ') || null;
  return {
    buildingCode, address, datum: ledger?.siteDatum ?? null, shareBasis: ledger?.shareBasis ?? null, shareTotalPct: ledger?.shareTotalPct ?? null,
    asOf: residents?.asOf ?? null, registers: residents ? `${residents.registers.deedIndex.name}; ${residents.registers.residentRegister.name}` : null,
    floors: new Map(model.levels.map((l) => [l.id, { label: l.label, use: l.record.use ?? null, bottom: l.lower, top: l.upper, ground }])),
    units: new Map(model.spaces.filter((s) => !s.parentId).map((s) => {
      const l = ledger?.spaces.find((x) => x.spaceId === s.id);
      const r = byUnit.get(s.id);
      const wf = workflow.get(s.id);
      return [s.id, {
        level: s.levelId ? levelLabel.get(s.levelId) ?? null : null, use: s.use, rights: l?.rights ?? 'unknown',
        carpetM2: l?.carpetAreaM2?.value ?? null, declaredM2: l?.declaredAreaM2?.value ?? null, sharePct: l?.sharePct?.value ?? null,
        code: wf?.code ?? null, status: wf?.status ?? (l?.status ? l.status.replace('_', ' ') : 'draft'),
        occupancy: r ? OCCUPANCY[r.occupancy] ?? r.occupancy : null,
        holders: r?.holders ?? [], occupants: r?.occupants ?? [],
      }];
    })),
  };
}

const esc = (v: unknown) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const num = (v: number | null | undefined, d = 2) => (v === null || v === undefined ? null : Math.round(v * 10 ** d) / 10 ** d);
const dateText = (v: string | null | undefined) => (v ? new Date(v).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : null);
/** One source's line in the register, ending with what the server states about its document reading, if anything. */
function sourceHtml(s: Report['sources'][number], i: number): string {
  const reading = readingStatement(s.documentResult);
  const facts = [
    `<b>S${i + 1}</b>`, esc(s.profile), `revision ${s.revision}`, `received ${esc(dateText(s.receivedAt))}`,
    `<span class="id">${esc(s.id)}</span>`, `SHA-256 <span class="id">${esc(s.sha256)}</span>`,
    ...(reading ? [`document reading: ${esc(reading)}`] : []),
  ];
  return `<div class="src">${facts.join(' · ')}</div>`;
}
const isUnit = (use: string | null | undefined) => !use || /apartment|retail|shop|office|flat|unit/i.test(use);

// ------------------------------------------------------------------ readable document

export function registryHtml(report: Report, detail?: RegistryDetail): string {
  const ref = new Map(report.sources.map((s, i) => [s.id, `S${i + 1}`]));
  const refs = (ids: string[]) => (ids.length ? ` <sup class="ref">${ids.map((id) => ref.get(id) ?? '?').join(',')}</sup>` : '');
  const fact = (f: Field) => (f.state === 'recorded' ? `${esc(f.value)}${refs(f.sources)}` : `<i class="st">${esc(f.state === 'unknown' ? 'Unknown' : f.state)}</i>`);
  const blank = (v: unknown) => (v === null || v === undefined || v === '' ? '<i class="st">Unknown</i>' : esc(v));
  const b = report.building;
  const hasBuildingCode = identifierColumns([detail?.buildingCode ?? null]).includes('projectCode');
  const byId = new Map(report.records.map((r) => [r.id, r]));
  const floorGroups = report.groups.filter((g) => g.kind === 'floor');
  const floorOrder = (id: string) => detail?.floors.get(id)?.bottom ?? 0;
  floorGroups.sort((x, y) => floorOrder(y.parentIds[0]!) - floorOrder(x.parentIds[0]!));
  const units = report.records.filter((r) => r.kind === 'space' && isUnit(detail?.units.get(r.id)?.use));
  const people = units.reduce((n, r) => n + r.occupancy.people.length, 0);
  const occ = (k: string) => units.filter((r) => detail?.units.get(r.id)?.occupancy === k).length;
  const addr = units[0]?.address ?? report.records[0]?.address;
  const parcel = report.parcels[0];

  const floorSection = (g: Report['groups'][number]) => {
    const floor = byId.get(g.parentIds[0]!);
    const fd = floor ? detail?.floors.get(floor.id) : undefined;
    const members = g.recordIds.map((id) => byId.get(id)!).filter((r) => r && r.kind === 'space');
    const flats = members.filter((r) => isUnit(detail?.units.get(r.id)?.use));
    const common = members.filter((r) => !isUnit(detail?.units.get(r.id)?.use));
    const hasUnitCode = identifierColumns(flats.map((r) => detail?.units.get(r.id)?.code ?? null))
      .includes('projectCode');
    const codeHeader = hasUnitCode ? `<th style="width:15%">${IDENTIFIER_HEADERS.projectCode}</th>` : '';
    const height = fd && fd.bottom !== null && fd.top !== null ? `${(fd.bottom - fd.ground).toFixed(1)} to ${(fd.top - fd.ground).toFixed(1)} m above ground` : '';
    return `<section class="floor"><h3>${floor ? fact(floor.name) : 'Floor'} <span class="sub">${esc(height)}${flats.length ? ` · ${flats.length} unit${flats.length > 1 ? 's' : ''}` : ''}</span></h3>
      ${flats.length ? `<table><thead><tr><th style="width:9%">Unit</th>${codeHeader}
      <th class="n" style="width:7%">Carpet m²</th><th class="n" style="width:7%">Share %</th>
      <th style="width:22%">Registered owners</th><th style="width:28%">Residents</th>
      <th style="width:12%">Occupancy</th></tr></thead><tbody>
      ${flats.map((r) => {
        const d = detail?.units.get(r.id);
        const owners = r.ownershipClaims.length ? r.ownershipClaims.map((c, i) => `${fact(c.party)}${d?.holders[i] ? `<div class="meta">${esc(d.holders[i]!.deedNo)} · since ${esc(dateText(d.holders[i]!.since))}${d.holders.length > 1 ? ` · ${d.holders[i]!.sharePct} %` : ''}</div>` : ''}`).join('') : '<i class="st">Unknown</i>';
        const res = r.occupancy.state !== 'recorded' ? '<i class="st">Unknown</i>' : r.occupancy.people.length ? r.occupancy.people.map((p, i) => `<div>${fact(p.name)} <span class="meta">· ${esc(d?.occupants[i]?.relation ?? p.role)}${d?.occupants[i] ? `, since ${esc(dateText(d.occupants[i]!.since))}` : ''}</span></div>`).join('') : '<i class="st">No one registered</i>';
        const codeCell = hasUnitCode ? `<td class="id">${d?.code ? esc(d.code) : 'Not stated'}</td>` : '';
        return `<tr><td><b>${fact(r.name)}</b><div class="id">${esc(r.applicationId)}</div></td>
          ${codeCell}
          <td class="n">${blank(num(d?.carpetM2))}</td><td class="n">${blank(num(d?.sharePct, 3))}</td><td>${owners}</td><td>${res}</td><td>${blank(d?.occupancy)}</td></tr>`;
      }).join('')}</tbody></table>` : ''}
      ${common.length ? `<p class="common">Common areas: ${common.map((r) => fact(r.name)).join(', ')}</p>` : ''}
    </section>`;
  };

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(b.name.value ?? 'Building')} · Building register</title><style>
@page{size:A4 landscape;margin:12mm}*{box-sizing:border-box}body{font:9.5pt/1.4 "Noto Sans",Arial,sans-serif;color:#1c2430;margin:0;padding:0 2mm}
header{display:grid;grid-template-columns:1fr auto;gap:12px;border-bottom:2.5px solid #1f4e3d;padding-bottom:10px;margin-bottom:12px}
.eyebrow{font-size:8pt;letter-spacing:.08em;text-transform:uppercase;color:#56615a}h1{font-size:20pt;margin:4px 0 2px}h2{font-size:12pt;color:#1f4e3d;margin:16px 0 6px;border-bottom:1px solid #cfd8d2;padding-bottom:3px;break-after:avoid}
h3{font-size:10.5pt;margin:12px 0 5px;break-after:avoid}.sub{font-weight:400;color:#56615a;font-size:9pt}.meta,.ref{color:#56615a;font-size:7.5pt}.ref{font-size:6.5pt}
.id{font-family:"Noto Sans Mono",monospace;font-size:7.5pt;color:#3c4a42;overflow-wrap:anywhere}.st{color:#7a8580}.headright{text-align:right;font-size:8.5pt;color:#3c4a42}
.facts{display:grid;grid-template-columns:repeat(4,1fr);gap:6px 14px;background:#f3f6f4;border:1px solid #d9e1dc;border-radius:6px;padding:10px 12px}
.facts div span{display:block;color:#56615a;font-size:7.5pt;text-transform:uppercase;letter-spacing:.05em}.facts div b{font-size:10pt}
table{width:100%;border-collapse:collapse;table-layout:fixed;margin:4px 0 6px}th{background:#1f4e3d;color:#fff;text-align:left;font-weight:600;padding:5px 6px;font-size:8.5pt}
td{padding:4px 6px;border-bottom:1px solid #dde3df;vertical-align:top;overflow-wrap:anywhere}tr:nth-child(even) td{background:#f7f9f8}.n{text-align:right;font-variant-numeric:tabular-nums}
thead{display:table-header-group}tr{break-inside:avoid}.floor{break-inside:auto}.common{margin:2px 0 8px;color:#3c4a42;font-size:8.5pt}
.src{font-size:8pt;border-bottom:1px solid #e3e8e5;padding:3px 0;break-inside:avoid}.notes p{margin:3px 0;font-size:8pt;color:#3c4a42}footer{margin-top:14px;font-size:7.5pt;color:#56615a}
</style></head><body>
<header><div><div class="eyebrow">BhuAayam · Building register · ${esc(report.schemaVersion)}</div><h1>${fact(b.name)}</h1>
<div>${detail?.address ? esc(detail.address) : addr ? [addr.locality, addr.district, addr.region, addr.postalCode, addr.country].filter((f) => f.state === 'recorded').map((f) => esc(f.value)).join(', ') || '<i class="st">Address unknown</i>' : '<i class="st">Address unknown</i>'}</div></div>
<div class="headright">Generated ${esc(new Date(report.generatedAt).toLocaleString('en-IN'))}<br>Building revision ${b.revision}${b.recordedAt ? ` · recorded ${esc(dateText(b.recordedAt))}` : ''}<br>Record state: ${esc(report.recordState)}</div></header>
<div class="facts">
 ${hasBuildingCode ? `<div><span>${IDENTIFIER_HEADERS.projectCode}</span>
   <b class="id">${blank(detail?.buildingCode)}</b></div>` : ''}
 <div><span>Application ID</span><b class="id">${esc(b.applicationId)}</b></div>
 <div><span>Parcel ULPIN / parcel</span><b class="id">${parcel ? esc(parcel.applicationId) : '<i class="st">Unknown</i>'}</b></div>
 <div><span>Area</span><b>${fact(b.areaName)}</b></div>
 <div><span>Floors</span><b>${floorGroups.length}</b></div>
 <div><span>Units</span><b>${units.length}</b></div>
 <div><span>Registered residents</span><b>${people}</b></div>
 <div><span>Owner-occupied · rented · vacant</span><b>${occ('Owner-occupied')} · ${occ('Rented')} · ${occ('Vacant')}</b></div>
 <div><span>Share basis</span><b>${blank(detail?.shareBasis)}</b></div>
 <div><span>Shares total</span><b>${detail?.shareTotalPct !== null && detail?.shareTotalPct !== undefined ? `${detail.shareTotalPct.toFixed(2)} %` : '<i class="st">Unknown</i>'}</b></div>
 <div><span>Height datum</span><b>${blank(detail?.datum)}</b></div>
 <div><span>Register extract as of</span><b>${blank(dateText(detail?.asOf))}</b></div>
</div>
${parcel ? `<h2>Parcel</h2><table><tbody><tr><td style="width:25%">Parcel</td><td class="id">${esc(parcel.applicationId)}</td></tr>
<tr><td>Official 2D ULPIN / parcel number</td><td>${parcel.officialAssertions.map((a) => `${fact(a.value)} · issued by ${fact(a.issuer)} · ${esc(a.state.replace(/_/g, ' '))}`).join('<br>') || '<i class="st">Unknown</i>'}</td></tr>
<tr><td>Association</td><td>${esc(parcel.relationship)} · ${esc(parcel.associationState.replace(/_/g, ' '))}${refs(parcel.sources)}</td></tr></tbody></table>` : ''}
<h2>Floors, units, owners and residents</h2>
${floorGroups.map(floorSection).join('')}
<h2>Sources</h2>
${report.sources.map(sourceHtml).join('')}
<h2>Notes</h2><div class="notes">${report.omissions.map((o) => `<p>${esc(o)}</p>`).join('')}</div>
<footer>Technical record of the building, not a title document. ${detail?.registers ? `Owners and residents from: ${esc(detail.registers)}.` : ''} Personal details are for official use.</footer>
</body></html>`;
}

// ------------------------------------------------------------------ tables

export interface RegistryTables { floors: Cell[][]; units: Cell[][]; owners: Cell[][]; residents: Cell[][]; sources: Cell[][]; building: [string, Cell][] }
export const TABLE_HEADERS = {
  floors: ['floor_record_id', 'application_id', 'level', 'use', 'bottom_above_ground_m', 'top_above_ground_m', 'bottom_datum_m', 'top_datum_m', 'units', 'residents'],
  units: ['unit_record_id', 'application_id', 'level', 'unit', 'use', 'proposed_3d_ulpin', 'rights', 'carpet_area_m2', 'declared_area_m2', 'undivided_share_pct', 'occupancy', 'owners', 'residents', 'status', 'address'],
  owners: ['unit_record_id', 'level', 'unit', 'owner', 'share_in_unit_pct', 'deed_registration_no', 'owner_since', 'source_ref'],
  residents: ['unit_record_id', 'level', 'unit', 'name', 'relation', 'role', 'living_here_since', 'registered_through', 'source_ref'],
  sources: ['source_ref', 'source_id', 'profile', 'revision', 'received_at', 'sha256', 'document_reading'],
} as const;

function projectCodeFacts(code: string | null): [string, Cell][] {
  return identifierColumns([code]).includes('projectCode') ? [[IDENTIFIER_HEADERS.projectCode, code]] : [];
}

export function registryTables(report: Report, detail: RegistryDetail): RegistryTables {
  const ref = new Map(report.sources.map((s, i) => [s.id, `S${i + 1}`]));
  const v = (f: Field) => (f.state === 'recorded' ? f.value : f.state === 'unknown' ? null : `[${f.state}]`);
  const floorName = new Map(report.records.filter((r) => r.kind === 'floor').map((r) => [r.id, v(r.name)]));
  const unitsOf = (floorId: string) => report.records.filter((r) => r.kind === 'space' && r.links.some((l) => l.type === 'floor' && l.targetId === floorId));
  const levelOf = (r: Report['records'][number]) => detail.units.get(r.id)?.level ?? floorName.get(r.links.find((l) => l.type === 'floor')?.targetId ?? '') ?? null;
  const addr = (r: Report['records'][number]) => [r.address.line, r.address.locality, r.address.district, r.address.region, r.address.postalCode, r.address.country].map(v).filter(Boolean).join(', ') || null;
  const b = report.building;
  const units = report.records.filter((r) => r.kind === 'space');
  return {
    building: [
      ['Building', v(b.name)], ['Building record ID', b.id], ['Application ID', b.applicationId],
      ...projectCodeFacts(detail.buildingCode),
      ['Address', detail.address], ['Parcel', report.parcels[0]?.applicationId ?? null],
      ['Official parcel number', report.parcels[0]?.officialAssertions[0]?.value.value ?? null], ['Issued by', report.parcels[0]?.officialAssertions[0]?.issuer.value ?? null],
      ['Area', v(b.areaName)], ['Building revision', b.revision], ['Recorded', b.recordedAt], ['Floors', report.records.filter((r) => r.kind === 'floor').length],
      ['Units', units.filter((r) => isUnit(detail.units.get(r.id)?.use)).length], ['Registered residents', units.reduce((n, r) => n + r.occupancy.people.length, 0)],
      ['Share basis', detail.shareBasis], ['Shares total %', detail.shareTotalPct], ['Height datum', detail.datum], ['Register extract as of', detail.asOf],
      ['Owners and residents from', detail.registers], ['Report schema', report.schemaVersion], ['Generated', report.generatedAt],
    ],
    floors: report.records.filter((r) => r.kind === 'floor').map((r) => {
      const f = detail.floors.get(r.id);
      const members = unitsOf(r.id);
      return [r.id, r.applicationId, v(r.name), f?.use ?? null, f && f.bottom !== null ? num(f.bottom - f.ground) : null, f && f.top !== null ? num(f.top - f.ground) : null,
        num(f?.bottom), num(f?.top), members.filter((m) => isUnit(detail.units.get(m.id)?.use)).length, members.reduce((n, m) => n + m.occupancy.people.length, 0)];
    }).sort((a, b) => Number(b[6] ?? 0) - Number(a[6] ?? 0)),
    units: units.map((r) => {
      const d = detail.units.get(r.id);
      return [r.id, r.applicationId, levelOf(r), v(r.name), d?.use ?? null, d?.code ?? null, d?.rights ?? 'unknown', num(d?.carpetM2), num(d?.declaredM2), num(d?.sharePct, 3),
        d?.occupancy ?? null, r.ownershipClaims.map((c) => v(c.party)).filter(Boolean).join('; ') || null, r.occupancy.state === 'recorded' ? r.occupancy.people.length : null, d?.status ?? null, addr(r)];
    }),
    owners: units.flatMap((r) => r.ownershipClaims.map((c, i) => {
      const h = detail.units.get(r.id)?.holders[i];
      return [r.id, levelOf(r), v(r.name), v(c.party), h?.sharePct ?? null, h?.deedNo ?? null, h?.since ?? null, c.sources.map((s) => ref.get(s)).join(' ')];
    })),
    residents: units.flatMap((r) => r.occupancy.people.map((p, i) => {
      const o = detail.units.get(r.id)?.occupants[i];
      return [r.id, levelOf(r), v(r.name), v(p.name), o?.relation ?? null, p.role, o?.since ?? null, o?.registeredVia ?? null, r.occupancy.sources.map((s) => ref.get(s)).join(' ')];
    })),
    sources: report.sources.map((s, i) => [
      `S${i + 1}`, s.id, s.profile, s.revision, s.receivedAt, s.sha256, readingStatement(s.documentResult),
    ]),
  };
}

const csvCell = (v: Cell) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export const csv = (header: readonly string[], rows: Cell[][]) => '﻿' + [header as unknown as Cell[], ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

export function registryWorkbook(t: RegistryTables): Blob {
  return workbook([
    { name: 'Building', header: ['Field', 'Value'], rows: t.building, widths: [28, 70] },
    { name: 'Floors', header: [...TABLE_HEADERS.floors], rows: t.floors },
    { name: 'Units', header: [...TABLE_HEADERS.units], rows: t.units },
    { name: 'Owners', header: [...TABLE_HEADERS.owners], rows: t.owners },
    { name: 'Residents', header: [...TABLE_HEADERS.residents], rows: t.residents },
    { name: 'Sources', header: [...TABLE_HEADERS.sources], rows: t.sources },
  ]);
}

const sha256 = async (bytes: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>))].map((x) => x.toString(16).padStart(2, '0')).join('');

/** The data package: every file listed in manifest.json with its size and SHA-256. */
export async function registryPackage(report: Report, detail: RegistryDetail, cityJson: string | null, stem: string): Promise<Blob> {
  const t = registryTables(report, detail);
  const enc = new TextEncoder();
  const files: [string, Uint8Array, string][] = [
    ['registry.json', enc.encode(JSON.stringify(report, null, 2)), 'Consolidated registry (building-registry-summary/1): building, floors, units, address, owners and residents, each fact with its state and sources'],
    ['register.html', enc.encode(registryHtml(report, detail)), 'Readable building register; open in a browser and print or save as PDF'],
    ['register.xlsx', new Uint8Array(await registryWorkbook(t).arrayBuffer()), 'All tables in one Excel workbook'],
    ['tables/building.csv', enc.encode(csv(['field', 'value'], t.building)), 'Building facts'],
    ['tables/floors.csv', enc.encode(csv(TABLE_HEADERS.floors, t.floors)), 'One row per floor'],
    ['tables/units.csv', enc.encode(csv(TABLE_HEADERS.units, t.units)), 'One row per unit or common area; joins on unit_record_id'],
    ['tables/owners.csv', enc.encode(csv(TABLE_HEADERS.owners, t.owners)), 'One row per registered owner of a unit'],
    ['tables/residents.csv', enc.encode(csv(TABLE_HEADERS.residents, t.residents)), 'One row per registered resident or occupant'],
    ['tables/sources.csv', enc.encode(csv(TABLE_HEADERS.sources, t.sources)), 'Sources cited as S1, S2 … with SHA-256'],
    ...(cityJson ? [['building.city.json', enc.encode(cityJson), 'CityJSON 2.0: building, storeys and units as LoD2 solids'] as [string, Uint8Array, string]] : []),
  ];
  const listed = await Promise.all(files.map(async ([path, bytes, description]) => ({ path, bytes: bytes.length, sha256: await sha256(bytes), description })));
  const manifest = { package: 'bhuaayam-building-register/1', building: { id: report.building.id, applicationId: report.building.applicationId, name: report.building.name.value, revision: report.building.revision }, generatedAt: report.generatedAt, files: listed };
  const readme = [`${report.building.name.value ?? 'Building'} — building register data package`, '', `Generated ${report.generatedAt}. Building revision ${report.building.revision}.`, '',
    ...listed.map((f) => `${f.path.padEnd(22)} ${f.description}`), 'manifest.json          Every file with its size and SHA-256', '',
    'Tables join on unit_record_id / floor_record_id. Empty cells are unknown, never zero.', 'Technical record of the building, not a title document. Personal details are for official use.', ''].join('\n');
  const entries: Record<string, string | Uint8Array> = { [`${stem}/README.txt`]: readme, [`${stem}/manifest.json`]: JSON.stringify(manifest, null, 2) };
  for (const [path, bytes] of files) entries[`${stem}/${path}`] = bytes;
  return new Blob([zip(entries)], { type: 'application/zip' });
}

/** Opens the readable register in a new window with the print dialog (Save as PDF). */
export function printRegistry(html: string) {
  const win = window.open('', '_blank');
  if (!win) return false;
  win.document.write(html.replace('</body>', '<script>window.onload=()=>setTimeout(()=>window.print(),250)</script></body>'));
  win.document.close();
  return true;
}
