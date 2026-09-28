import { ConsolidatedRegistryReportSchema, type ConsolidatedRegistryReport } from '../../../../packages/contracts/src/building-registry-report';
import { registryReportTextSafe } from '../../../../packages/contracts/src/registry-metadata';
import type { BuildingLedger, BuildingResidents } from '@ulpin/api-client/draft';
import { stableUuid } from '../../../../scripts/demo-import/sample-registry.mjs';

/**
 * GET /buildings/{id}/register?profile=consolidated (format json | html) answered by the local layer in the
 * backend's `building-registry-summary/1` shape: the building, its floors and units with recorded address,
 * ownership claims and residents, each fact with its state and source references.
 */
type Field = ConsolidatedRegistryReport['building']['name'];
type Record_ = ConsolidatedRegistryReport['records'][number];
interface RegisterRecordLike { id: string; identifier: string; name: string; kind: string; revision: number; use?: string | null; links: { targetId: string; type: string }[]; evidence?: { sourceId?: string; sourceRevisionId?: string }[] }
interface RegisterLike {
  property: { id: string; identifier: string; name: string; revision: number };
  area: { id: string; name: string; revision: number };
  register: RegisterRecordLike[];
  sources: { id: string; sha256: string; revision?: number; createdAt?: string; profile?: string; name?: string }[];
}

const unknown = (): Field => ({ state: 'unknown', value: null, sources: [] });
const iso = (value: string | undefined | null) => new Date(value ?? Date.now()).toISOString();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function consolidatedReport(reg: RegisterLike, ledger: BuildingLedger | null, residents: BuildingResidents | null, generatedAt = new Date().toISOString()): ConsolidatedRegistryReport {
  const known = new Map<string, ConsolidatedRegistryReport['sources'][number]>();
  const addSource = (id: string, sha256: string, profile: string, receivedAt: string, revision = 1) => {
    if (UUID.test(id) && /^[a-f0-9]{64}$/.test(sha256) && !known.has(id)) known.set(id, { id, revision: Math.max(1, revision), sha256, profile, receivedAt: iso(receivedAt) });
  };
  for (const s of reg.sources) addSource(s.id, s.sha256, s.profile ?? (s.name?.split('.').pop() ?? 'source'), s.createdAt ?? generatedAt, s.revision);
  if (residents) for (const r of Object.values(residents.registers)) addSource(r.id, r.sha256, r.profile, r.receivedAt);
  const cite = (ids: (string | undefined | null)[]) => [...new Set(ids.filter((id): id is string => Boolean(id && known.has(id))))];
  const text = (value: string | null | undefined, sources: string[] = []): Field => {
    if (!value?.trim()) return unknown();
    if (value.length > 250 || !registryReportTextSafe(value)) return { state: 'withheld', value: null, sources };
    return { state: 'recorded', value, sources };
  };
  const recordedAt = ledger?.revisions[0]?.at ? iso(ledger.revisions[0].at) : null;
  const evidenceOf = (r: RegisterRecordLike) => cite((r.evidence ?? []).map((e) => e.sourceId ?? e.sourceRevisionId));

  const deed = residents ? [residents.registers.deedIndex.id] : [];
  const society = residents ? [residents.registers.residentRegister.id] : [];
  const addr = residents?.address;
  const address = (unitName: string | null): Record_['address'] => ({
    line: text(addr?.line ? (unitName ? `${unitName}, ${reg.property.name}, ${addr.line}` : `${reg.property.name}, ${addr.line}`) : null, deed),
    locality: text(addr?.locality, deed), district: text(addr?.district, deed), region: text(addr?.region, deed),
    postalCode: text(addr?.postalCode, deed), country: text(addr?.country, deed),
  });
  const byUnit = new Map((residents?.units ?? []).map((u) => [u.spaceId, u]));
  const top = reg.register.filter((r) => r.kind === 'floor' || (r.kind === 'space' && !r.links.some((l) => l.type === 'within' && reg.register.some((x) => x.id === l.targetId && x.kind === 'space'))));
  const records: Record_[] = top.slice(0, 2000).map((r) => {
    const unit = byUnit.get(r.id);
    const links = r.links.filter((l) => ['within', 'floor', 'serves', 'crosses'].includes(l.type) && UUID.test(l.targetId)) as Record_['links'];
    return {
      id: r.id, applicationId: r.identifier.slice(0, 250), kind: r.kind === 'floor' ? 'floor' : 'space', revision: r.revision,
      name: text(r.name, evidenceOf(r)), recordedAt, links: links.slice(0, 30),
      address: address(r.kind === 'space' ? r.name : null),
      ownershipClaims: (unit?.holders ?? []).slice(0, 30).map((h) => ({ party: text(h.name, deed), sources: deed })),
      occupancy: unit
        ? { state: 'recorded', sources: society, people: unit.occupants.slice(0, 30).map((o) => ({ name: text(o.name, society), role: /tenant/i.test(o.relation) ? 'occupant' as const : 'resident' as const })) }
        : { state: 'unknown', sources: [], people: [] },
    };
  });

  const parcelValue = ledger?.parcelUlpin?.replace(/^BBL\s+/, '') ?? null;
  const us = /^BBL/.test(ledger?.parcelUlpin ?? '');
  const parcels: ConsolidatedRegistryReport['parcels'] = parcelValue ? [{
    id: stableUuid(`parcel:${parcelValue}`), applicationId: ledger!.parcelUlpin!, kind: 'parcel', revision: 1, authority: 'registry_record',
    relationship: 'within', associationState: 'recorded_link', sources: deed,
    officialAssertions: [{
      value: /^[A-Z0-9-]{1,100}$/i.test(parcelValue) ? { state: 'recorded', value: parcelValue, sources: deed } : unknown(),
      issuer: text(us ? 'NYC Department of Finance (borough-block-lot)' : 'Maharashtra Land Records (Bhumi Abhilekh)', deed),
      state: 'recorded_unverified',
    }],
  }] : [];

  const report: ConsolidatedRegistryReport = {
    schemaVersion: 'building-registry-summary/1', generatedAt, selection: { id: reg.property.id, kind: 'building' },
    recordState: 'recorded', sourcePackage: null, unrecordedFacts: null, groups: groups(records),
    building: {
      id: reg.property.id, applicationId: reg.property.identifier.slice(0, 250), kind: 'building', revision: Math.max(1, reg.property.revision),
      name: text(reg.property.name, cite(reg.sources.map((s) => s.id)).slice(0, 1)), areaName: text(reg.area.name),
      areaRevision: Math.max(0, reg.area.revision), siteRevision: Math.max(0, reg.area.revision), recordedAt,
    },
    parcels, records, sources: [...known.values()].slice(0, 1000),
    omissions: [
      'This report records registry facts and claims. Technical review and physical geometry do not establish ownership or official issuance.',
      'Residents and occupants are included only when explicitly recorded with evidence; ownership claims do not establish residency.',
      'Unknown means no value is recorded here. Absent, null, withheld and conflicting are distinct recorded states.',
      'Application identifiers are separate from official 2D parcel ULPIN assertions. Parcel links are explicit recorded associations; intersection is not used.',
      'Contact details and identity numbers are omitted.',
    ],
  };
  return ConsolidatedRegistryReportSchema.parse(report);
}

/** Each record once: floors with the units linked to them, then anything else. */
function groups(records: Record_[]): ConsolidatedRegistryReport['groups'] {
  const byId = new Map(records.map((r) => [r.id, r]));
  const out = new Map<string, ConsolidatedRegistryReport['groups'][number]>();
  const push = (kind: ConsolidatedRegistryReport['groups'][number]['kind'], parents: string[], id: string) => {
    const key = `${kind}:${parents.join(',')}`;
    const g = out.get(key) ?? { kind, parentIds: parents, recordIds: [] };
    g.recordIds.push(id); out.set(key, g);
  };
  for (const r of records) {
    if (r.kind === 'floor') { push('floor', [r.id], r.id); continue; }
    const floors = [...new Set(r.links.filter((l) => l.type === 'floor').map((l) => l.targetId))];
    if (floors.length > 1) push('multiple_parents', floors, r.id);
    else if (!floors.length) push('unlinked', [], r.id);
    else push(byId.has(floors[0]!) ? 'floor' : 'outside_selection', floors, r.id);
  }
  const order = { building: 0, floor: 1, multiple_parents: 2, outside_selection: 3, unlinked: 4, cycle: 5 };
  return [...out.values()].sort((a, b) => order[a.kind] - order[b.kind]);
}
