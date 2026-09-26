import type { PublicBuilding, PublicBuildingSummary, PublicMap, PublicRecord, PublicRecordSummary, PublicSearch } from '@ulpin/api-client/draft';
import { lake } from './sources';
import { listAssigned, type SpaceWorkflow } from './workflow';
import { areaStarted, floorsDone, visibleFeatures, visibleLevelIds } from './story';
import { buildingCode } from './codes';

/**
 * The public projection (PUBLIC-01) of the local records: released units only, with no party names,
 * documents or utilities. A unit is released when its details are recorded, or once a proposed code is
 * assigned to it in this deployment's workflow. Every committed building is public with its 3D ULPIN.
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

type Feature = (typeof lake.context.features)[number];
const buildings = () => visibleFeatures().filter((f) => f.kind === 'building');
const areaName = lake.context.area.name;
const featureProps = (f: Feature) => (f.properties ?? {}) as Record<string, unknown>;

function buildingSummary(f: Feature, codes: Map<string, SpaceWorkflow>): PublicBuildingSummary {
  const isResidence = f.id === building.id;
  const parcel = isResidence ? ledger.parcelUlpin : typeof featureProps(f).parcel_ulpin === 'string' ? String(featureProps(f).parcel_ulpin) : null;
  const shown = isResidence ? visibleLevelIds() : new Set<string>();
  return {
    id: f.id, name: f.name, areaId: lake.context.area.id, areaName, code: buildingCode(f.id),
    location: f.identifier ? f.identifier.split('/') : null, parcelUlpin: parcel, address: isResidence ? ledger.address : null,
    heightM: typeof f.height?.value === 'number' ? f.height.value : null,
    levels: isResidence ? levels.filter((l) => shown.has(l.id)).length : 0,
    records: isResidence ? spaces.filter((s) => released(s, codes)).length : 0,
  };
}

async function assignedCodes(): Promise<Map<string, SpaceWorkflow>> {
  try { return new Map((await listAssigned()).map((w) => [w.spaceId, w])); } catch { return new Map(); }
}

function released(space: Record_, codes: Map<string, SpaceWorkflow>): boolean {
  if (space.use !== 'apartment' || !floorsDone()) return false;
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
  const items = buildings().some((b) => b.id === building.id) ? matched.filter((s) => released(s, codes)).map((s) => summary(s, codes)) : [];
  const bHay = (f: Feature) => [f.name, buildingCode(f.id), buildingCode(f.id).replace(/-/g, ''), f.identifier, featureProps(f).parcel_ulpin, f.id === building.id ? `${ledger.address} ${ledger.parcelUlpin}` : ''].join(' ').toLowerCase();
  const found = terms.length ? buildings().filter((f) => terms.every((t) => bHay(f).includes(t))) : [];
  return { q, total: items.length, items, notReleased: items.length ? matched.length - items.length : 0, buildings: found.map((f) => buildingSummary(f, codes)) };
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
  const feature = buildings().find((f) => f.id === id);
  if (!feature) return undefined;
  const codes = await assignedCodes();
  const s0 = buildingSummary(feature, codes);
  const base = { id, name: feature.name, areaId: s0.areaId, areaName, code: s0.code, location: s0.location, heightM: s0.heightM, footprint: feature.geometry as PublicBuilding['footprint'] };
  if (id !== building.id || !s0.levels) {
    return { ...base, address: s0.address, parcelUlpin: s0.parcelUlpin, datum: null, groundM: null, storeys: [], records: [], notReleased: 0, updatedAt: new Date().toISOString() };
  }
  const units = spaces.filter((s) => s.use === 'apartment');
  const shown = visibleLevelIds();
  return {
    ...base, address: ledger.address, parcelUlpin: ledger.parcelUlpin, datum: ledger.siteDatum,
    groundM: ledger.groundElevationM,
    storeys: levels.filter((l) => shown.has(l.id)).map((l) => ({
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

export async function publicAreas(): Promise<Array<{ id: string; name: string; records: number; buildings: number }>> {
  if (!areaStarted()) return [];
  const codes = await assignedCodes();
  const records = spaces.filter((s) => released(s, codes)).length;
  return [{ id: lake.context.area.id, name: areaName, records, buildings: buildings().length }];
}

export async function publicMap(areaId: string): Promise<PublicMap | undefined> {
  if (areaId !== lake.context.area.id || !areaStarted()) return undefined;
  const codes = await assignedCodes();
  const area = lake.context.area as unknown as { id: string; name: string; reference?: { sourceCrs: string; verticalReference: string } };
  const count = spaces.filter((s) => released(s, codes)).length;
  return {
    area: { id: area.id, name: area.name, reference: area.reference ? { sourceCrs: area.reference.sourceCrs, verticalReference: area.reference.verticalReference } : null },
    features: visibleFeatures().filter((f) => PUBLIC_KINDS.has(f.kind)).map((f) => {
      const props = (f.properties ?? {}) as Record<string, unknown>;
      // Only what a map needs: no source keys or survey attributes beyond the land cover and parcel code.
      return {
        id: f.id, kind: f.kind, name: f.name, identifier: f.identifier, geometry: f.geometry, height: f.height, semantics: (f as { semantics?: unknown }).semantics ?? null,
        ...(f.kind === 'building' ? { projectCode: buildingCode(f.id) } : {}),
        properties: { ...(props.land_cover ? { land_cover: props.land_cover } : {}), ...(props.ulpin ? { ulpin: props.ulpin } : {}) },
      };
    }),
    released: count ? [{ buildingId: building.id, records: count }] : [],
    buildings: buildings().map((f) => buildingSummary(f, codes)),
  };
}

/** Resolves a printed 3D ULPIN: a building's, or a released unit's. */
export async function publicCode(input: string): Promise<{ kind: 'building'; building: PublicBuildingSummary } | { kind: 'unit'; recordId: string } | undefined> {
  const code = input.trim().toUpperCase();
  const codes = await assignedCodes();
  const b = buildings().find((f) => buildingCode(f.id) === code);
  if (b) return { kind: 'building', building: buildingSummary(b, codes) };
  const unit = [...codes.values()].find((w) => w.code === code);
  return unit && spaces.some((s) => s.id === unit.spaceId && released(s, codes)) ? { kind: 'unit', recordId: unit.spaceId } : undefined;
}
