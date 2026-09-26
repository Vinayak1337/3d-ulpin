import type { PublicBuilding, PublicMap, PublicRecord, PublicRecordSummary, PublicSearch } from '@ulpin/api-client/draft';
import { lake } from './sources';
import { listAssigned, type SpaceWorkflow } from './workflow';

/**
 * The public projection (PUBLIC-01) of the local records: released units only, with no party names,
 * documents or utilities. A unit is released when its details are recorded, or once a proposed code is
 * assigned to it in this deployment's workflow.
 */
type Record_ = (typeof lake.register.register)[number];
type LedgerSpace = (typeof lake.ledger.spaces)[number];

const PUBLIC_KINDS = new Set(['building', 'parcel', 'road', 'public_land']);
const building = lake.register.property;
const ledger = lake.ledger;
const levels = lake.register.register.filter((r) => r.kind === 'floor');
const spaces = lake.register.register.filter((r) => r.kind === 'space');
const levelOf = (space: Record_) => levels.find((l) => space.links.some((k) => k.targetId === l.id && k.type === 'floor')) ?? null;
const ledgerOf = (id: string): LedgerSpace | undefined => ledger.spaces.find((s) => s.spaceId === id);
const latest = ledger.revisions[0]!;

async function assignedCodes(): Promise<Map<string, SpaceWorkflow>> {
  try { return new Map((await listAssigned()).map((w) => [w.spaceId, w])); } catch { return new Map(); }
}

function released(space: Record_, codes: Map<string, SpaceWorkflow>): boolean {
  if (space.use !== 'apartment') return false;
  return codes.has(space.id) || ledgerOf(space.id)?.status === 'reviewed';
}

function summary(space: Record_, codes: Map<string, SpaceWorkflow>): PublicRecordSummary {
  const wf = codes.get(space.id);
  return {
    id: space.id, name: space.name, buildingId: building.id, buildingName: building.name, address: ledger.address,
    level: levelOf(space)?.name ?? null, carpetAreaM2: ledgerOf(space.id)?.carpetAreaM2?.value ?? null,
    code: wf?.code ?? null, location: space.ulpin3d ? space.ulpin3d.split('/').map((p) => p.replace(/-/g, ' ')) : null,
    status: wf?.code ? 'assigned' : 'recorded',
  };
}

export async function publicSearch(q: string): Promise<PublicSearch> {
  const codes = await assignedCodes();
  const terms = q.toLowerCase().replace(/[^\w\s-]/g, ' ').split(/\s+/).filter(Boolean);
  const hay = (s: Record_) => [s.name, building.name, ledger.address, ledger.parcelUlpin, codes.get(s.id)?.code, levelOf(s)?.name].join(' ').toLowerCase();
  const units = spaces.filter((s) => s.use === 'apartment');
  const matched = terms.length ? units.filter((s) => terms.every((t) => hay(s).includes(t))) : [];
  const items = matched.filter((s) => released(s, codes)).map((s) => summary(s, codes));
  return { q, total: items.length, items, notReleased: matched.length - items.length };
}

export async function publicRecord(id: string): Promise<PublicRecord | undefined> {
  const codes = await assignedCodes();
  const space = spaces.find((s) => s.id === id);
  if (!space || !released(space, codes)) return undefined;
  const level = levelOf(space);
  const shared = spaces.filter((s) => s.use !== 'apartment' && levelOf(s)?.id === level?.id).map((s) => s.name);
  const wf = codes.get(space.id);
  return {
    ...summary(space, codes), levelId: level?.id ?? null,
    lowerM: level?.geometry?.lower ?? null, upperM: level?.geometry?.upper ?? null, datum: ledger.siteDatum,
    parcelUlpin: ledger.parcelUlpin, sharePct: ledgerOf(space.id)?.sharePct?.value ?? null, sharedSpaces: shared,
    revision: wf ? wf.events[0]!.revision : ledger.revision, revisionHash: wf ? wf.events[0]!.hash : latest.hash, updatedAt: wf?.assignedAt ?? latest.at,
  };
}

export async function publicBuilding(id: string): Promise<PublicBuilding | undefined> {
  if (id !== building.id) return undefined;
  const codes = await assignedCodes();
  const units = spaces.filter((s) => s.use === 'apartment');
  return {
    id, name: building.name, areaId: lake.context.area.id, address: ledger.address, parcelUlpin: ledger.parcelUlpin, datum: ledger.siteDatum,
    groundM: ledger.groundElevationM, footprint: building.geometry as PublicBuilding['footprint'],
    storeys: levels.map((l) => ({
      id: l.id, label: l.name, lowerM: l.geometry?.lower ?? null, upperM: l.geometry?.upper ?? null,
      estimated: !(l.geometry?.lowerVerified ?? true), belowGround: /^B\d/.test(l.name), use: l.use ?? null,
      spaces: spaces.filter((s) => levelOf(s)?.id === l.id).map((s) => ({
        id: s.id, name: released(s, codes) || s.use !== 'apartment' ? s.name : null, released: released(s, codes), shared: s.use !== 'apartment',
        polygon: { type: 'Polygon' as const, coordinates: [s.footprint as number[][]] }, lowerM: s.geometry?.lower ?? null, upperM: s.geometry?.upper ?? null,
      })),
    })),
    records: units.filter((s) => released(s, codes)).map((s) => summary(s, codes)),
    notReleased: units.filter((s) => !released(s, codes)).length,
    updatedAt: latest.at,
  };
}

export async function publicAreas(): Promise<Array<{ id: string; name: string; records: number }>> {
  const codes = await assignedCodes();
  return [{ id: lake.context.area.id, name: lake.context.area.name, records: spaces.filter((s) => released(s, codes)).length }];
}

export async function publicMap(areaId: string): Promise<PublicMap | undefined> {
  if (areaId !== lake.context.area.id) return undefined;
  const codes = await assignedCodes();
  const area = lake.context.area as unknown as { id: string; name: string; reference?: { sourceCrs: string; verticalReference: string } };
  const count = spaces.filter((s) => released(s, codes)).length;
  return {
    area: { id: area.id, name: area.name, reference: area.reference ? { sourceCrs: area.reference.sourceCrs, verticalReference: area.reference.verticalReference } : null },
    features: lake.context.features.filter((f) => PUBLIC_KINDS.has(f.kind)).map((f) => {
      const props = (f.properties ?? {}) as Record<string, unknown>;
      // Only what a map needs: no source keys or survey attributes beyond the land cover and parcel code.
      return {
        id: f.id, kind: f.kind, name: f.name, identifier: f.identifier, geometry: f.geometry, height: f.height, semantics: (f as { semantics?: unknown }).semantics ?? null,
        properties: { ...(props.land_cover ? { land_cover: props.land_cover } : {}), ...(props.ulpin ? { ulpin: props.ulpin } : {}) },
      };
    }),
    released: count ? [{ buildingId: building.id, records: count }] : [],
  };
}
