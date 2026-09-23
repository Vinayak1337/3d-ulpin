import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import {
  UspSnapshotManifestSchema, UspResolvedTargetSchema, UspScopePageSchema,
  UspAuthorizedAssetSchema, UspVerticalContextSchema, type RequestContext, type SnapshotScope, type EvidencePointer,
  type TargetPin,
} from '@ulpin/contracts/usp';
import { transaction } from '../db';
import { canonical, fingerprint } from '../domain';
import { AppError, notFound } from '../errors';
import { settings } from '../config';
import { readObject, sha256 } from '../storage';

type BodyRow = { namespace: string; object_id: string; revision: number; body: Record<string, any> };

export function assertLocalUsp(ctx: RequestContext) {
  // Context must be constructed server-side; this is a second fail-closed adapter guard.
  if (ctx.principal.mode !== 'local_demo' || ctx.principal.subject !== 'local-demo-operator') {
    throw new AppError(403, 'USP_LOCAL_ONLY', 'This workflow is limited to the local operator.');
  }
}

function recordPin(row: BodyRow): TargetPin {
  return { ref: { namespace: row.namespace, id: row.object_id }, revision: storedRevision(row.revision) };
}

export function storedRevision(value: unknown): number {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value))) {
    throw new AppError(503, 'USP_STORED_REVISION', 'A stored revision is unavailable.');
  }
  const revision = Number(value);
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new AppError(503, 'USP_STORED_REVISION', 'A stored revision is unavailable.');
  }
  return revision;
}

async function snapshotRows(client: PoolClient, siteId: string): Promise<BodyRow[]> {
  const site = (await client.query('SELECT * FROM registry_sites WHERE id=$1', [siteId])).rows[0] ?? notFound();
  const records = (await client.query(
    'SELECT * FROM registry_records WHERE site_id=$1 AND revision>0 ORDER BY id LIMIT 1001', [siteId],
  )).rows;
  if (records.length > 1000) throw new AppError(413, 'USP_SCOPE_LIMIT', 'Select a smaller property scope.');
  const features = (await client.query(
    `SELECT f.id,f.area_id,f.record_id,f.identifier,f.revision,f.body,
      ST_AsGeoJSON(f.geometry)::jsonb AS geometry,
      ST_AsGeoJSON(f.geographic_geometry)::jsonb AS geographic_geometry
     FROM physical_features f JOIN map_areas a ON a.id=f.area_id
     WHERE a.site_id=$1 AND f.revision>0 ORDER BY f.id LIMIT 1001`, [siteId],
  )).rows;
  if (features.length > 1000) throw new AppError(413, 'USP_SCOPE_LIMIT', 'Select a smaller property scope.');
  const sources = (await client.query(
    `SELECT s.* FROM sources s JOIN cases c ON c.id=s.case_id
     WHERE c.site_id=$1 ORDER BY s.id LIMIT 2001`, [siteId],
  )).rows;
  if (sources.length > 2000) throw new AppError(413, 'USP_SCOPE_LIMIT', 'Select a smaller property scope.');
  return ([
    { namespace: 'registry_site', object_id: site.id, revision: Number(site.revision), body: site },
    ...records.map(row => ({ namespace: 'registry_record', object_id: row.id, revision: Number(row.revision), body: row })),
    ...features.map(row => ({ namespace: 'area_feature', object_id: row.id, revision: Number(row.revision), body: row })),
    ...sources.map(row => ({ namespace: 'source_revision', object_id: row.id, revision: Number(row.revision), body: row })),
  ] as BodyRow[]).map(row => ({ ...row, body: JSON.parse(JSON.stringify(row.body)) }))
    .sort((a, b) => `${a.namespace}:${a.object_id}@${a.revision}`.localeCompare(`${b.namespace}:${b.object_id}@${b.revision}`));
}

export async function captureRegistrySnapshot(ctx: RequestContext, siteId: string, selection: { kind: 'site' } | { kind: 'targets'; pins: readonly TargetPin[] }) {
  assertLocalUsp(ctx);
  z.uuid().parse(siteId);
  return transaction(async client => {
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    return captureRegistrySnapshotTx(client, ctx, siteId, selection);
  });
}

export async function captureRegistrySnapshotTx(client: PoolClient, ctx: RequestContext, siteId: string, selection: { kind: 'site' } | { kind: 'targets'; pins: readonly TargetPin[] }) {
    assertLocalUsp(ctx);
    const rows = await snapshotRows(client, siteId);
    if (selection.kind === 'targets') {
      if (!selection.pins.length || selection.pins.length > 100) throw new AppError(422, 'USP_SELECTION', 'Choose 1 to 100 targets.');
      for (const pin of selection.pins) {
        if (!rows.some(row => row.namespace === pin.ref.namespace && row.object_id === pin.ref.id && row.revision === pin.revision)) {
          throw new AppError(409, 'USP_STALE_TARGET', 'The selected target is absent or changed.');
        }
      }
    }
    const site = rows.find(row => row.namespace === 'registry_site')!.body;
    const members = rows.map(row => ({ pin: recordPin(row), bodySha256: fingerprint(row.body),
      bodyRef: fingerprint([row.namespace, row.object_id, row.revision, row.body]),
      authority: row.namespace === 'registry_record' ? 'registry' as const
        : row.namespace === 'area_feature' ? 'area_feature' as const
        : row.namespace === 'source_revision' ? 'source' as const : 'registry' as const }));
    const normalizedSelection = selection.kind === 'site' ? { kind: 'site' as const, pins: [] }
      : { kind: 'targets' as const, pins: [...selection.pins].sort((a, b) =>
        `${a.ref.namespace}:${a.ref.id}`.localeCompare(`${b.ref.namespace}:${b.ref.id}`)) };
    const digest = fingerprint({ siteId, world: `registry-site/${siteId}`, stage: 'recorded',
      selection: normalizedSelection, members, frame: site.frame, policyVersion: ctx.policyVersion });
    const id = randomUUID();
    const scope = { kind: 'snapshot' as const, scopeId: siteId,
      world: { namespace: 'world', id: `registry-site/${siteId}` },
      manifestId: id, snapshotDigest: digest, stage: 'recorded' as const };
    const manifest = UspSnapshotManifestSchema.parse({
      schemaVersion: 'usp/1', id, digest, scope, capturedAt: new Date().toISOString(),
      selection: normalizedSelection, members,
      frame: { horizontal: site.frame?.id ?? null, vertical: site.frame?.benchmark ?? null,
        unit: site.frame?.horizontalUnit ?? null, transform: null },
      policyVersion: ctx.policyVersion, accessViewId: ctx.accessViewId,
      validAt: null, asOf: null, coverage: { state: 'complete', reasonCodes: [] },
    });
    await client.query('INSERT INTO usp_snapshots(id,scope_id,digest,body) VALUES($1,$2,$3,$4)', [id, siteId, digest, manifest]);
    for (const row of rows) await client.query(
      `INSERT INTO usp_snapshot_bodies(manifest_id,namespace,object_id,revision,body_sha256,body)
       VALUES($1,$2,$3,$4,$5,$6)`, [id, row.namespace, row.object_id, row.revision, fingerprint(row.body), row.body],
    );
    return manifest;
}

export async function readManifest(ctx: RequestContext, scope: SnapshotScope) {
  assertLocalUsp(ctx);
  z.uuid().parse(scope.scopeId);
  z.uuid().parse(scope.manifestId);
  const row = (await transaction(async client => (await client.query(
    'SELECT body FROM usp_snapshots WHERE id=$1 AND scope_id=$2 AND digest=$3',
    [scope.manifestId, scope.scopeId, scope.snapshotDigest],
  )).rows[0]))?.body;
  if (!row) throw new AppError(409, 'USP_MANIFEST_REFRESH', 'The exact snapshot is unavailable. Capture a new snapshot.');
  const manifest = UspSnapshotManifestSchema.parse(row);
  if (canonical(manifest.scope) !== canonical(scope)) throw new AppError(409, 'USP_SCOPE_STALE', 'The snapshot scope changed.');
  if (manifest.accessViewId !== ctx.accessViewId || manifest.policyVersion !== ctx.policyVersion) {
    throw new AppError(403, 'USP_ACCESS_CHANGED', 'Access changed. Refresh the selection.');
  }
  return manifest;
}

async function memberBody(scope: SnapshotScope, pin: TargetPin) {
  return (await transaction(async client => (await client.query(
    `SELECT body,body_sha256 FROM usp_snapshot_bodies WHERE manifest_id=$1
     AND namespace=$2 AND object_id=$3 AND revision=$4`,
    [scope.manifestId, pin.ref.namespace, pin.ref.id, pin.revision],
  )).rows[0] as { body: Record<string, any>; body_sha256: string } | undefined));
}

export async function readSnapshotBody(ctx: RequestContext, scope: SnapshotScope, pin: TargetPin) {
  await readManifest(ctx, scope);
  const found = await memberBody(scope, pin);
  if (!found || fingerprint(found.body) !== found.body_sha256) {
    throw new AppError(409, 'USP_REVISION_UNAVAILABLE', 'The exact captured revision is unavailable.');
  }
  return found.body;
}

function pointerFor(source: BodyRow, target: TargetPin, locator: string): EvidencePointer {
  return {
    sourceRevision: { ref: { namespace: 'source_revision', id: source.object_id }, revision: storedRevision(source.revision) },
    assetRevision: null, partRevision: null,
    locator: { kind: 'verbatim', locator }, legacyLocator: locator,
    purpose: 'record', origin: 'direct', target: target.ref,
  };
}

export async function resolveRegistryTarget(ctx: RequestContext, scope: SnapshotScope, pin: TargetPin) {
  const manifest = await readManifest(ctx, scope);
  if (!manifest.members.some(member => canonical(member.pin) === canonical(pin))) {
    return { state: 'unavailable' as const, reasonCode: 'target_not_in_snapshot' };
  }
  const captured = await memberBody(scope, pin);
  if (!captured || fingerprint(captured.body) !== captured.body_sha256) {
    return { state: 'unavailable' as const, reasonCode: 'unavailable_revision' };
  }
  const row = captured.body;
  if (pin.ref.namespace !== 'registry_record') return { state: 'not_assessed' as const, reasonCode: 'backing_not_supported' };
  const sources = (await transaction(async client => (await client.query(
    `SELECT namespace,object_id,revision,body FROM usp_snapshot_bodies
     WHERE manifest_id=$1 AND namespace='source_revision'`, [scope.manifestId],
  )).rows as BodyRow[]));
  const bindings = [...(row.body?.evidence ?? []),
    ...(row.body?.rights ?? []).map((right: { evidence?: { sourceId: string; locator: string } }) => right.evidence).filter(Boolean)];
  const uniqueBindings = [...new Map(bindings.map((binding: { sourceId: string; locator: string }) =>
    [`${binding.sourceId}:${binding.locator}`, binding])).values()];
  const evidence = uniqueBindings.flatMap((binding: { sourceId: string; locator: string }) => {
    const source = sources.find(item => item.object_id === binding.sourceId);
    return source ? [pointerFor(source, pin, binding.locator)] : [];
  });
  const kind = row.kind;
  const relations = (row.body?.links ?? []).flatMap((link: { targetId: string; type: string }) => {
    const member = manifest.members.find(item => item.pin.ref.namespace === 'registry_record' && item.pin.ref.id === link.targetId);
    return member && ['within', 'floor', 'serves', 'crosses'].includes(link.type)
      ? [{ kind: link.type, target: member.pin }] : [];
  });
  const result = UspResolvedTargetSchema.parse({ pin, scope,
    backing: { kind: 'registry', siteId: row.site_id, recordId: row.id },
    kind, label: row.body?.name ?? row.identifier,
    identifiers: [
      { scheme: kind === 'parcel' ? 'application-registry-id' : 'application-3d-ulpin',
        value: row.identifier, issuer: null, source: null, state: 'reviewed' },
      ...(kind === 'parcel' && row.body?.officialUlpin
        ? [{ scheme: 'supplied-parcel-ulpin', value: row.body.officialUlpin,
          issuer: null, source: null, state: 'supplied' }] : []),
    ],
    relations, representations: [], evidence, recordState: 'recorded',
    capabilities: ['source-evidence', ...(row.body?.geometry ? ['local-geometry'] : [])],
  });
  return { state: 'available' as const, data: result };
}

/** A supplied floor or space must retain its actual parent chain. */
export async function resolveRegistryVerticalContext(ctx: RequestContext, scope: SnapshotScope,
  buildingPin: TargetPin, floorPin: TargetPin, spacePin: TargetPin) {
  const [building, floor, space] = await Promise.all([
    resolveRegistryTarget(ctx, scope, buildingPin),
    resolveRegistryTarget(ctx, scope, floorPin),
    resolveRegistryTarget(ctx, scope, spacePin),
  ]);
  if (building.state !== 'available' || floor.state !== 'available' || space.state !== 'available') {
    return { state: 'unavailable' as const, reasonCode: 'selection_revision_unavailable' };
  }
  if (!hasVerticalMembership(building.data, floor.data, space.data)) {
    return { state: 'unavailable' as const, reasonCode: 'invalid_vertical_membership' };
  }
  return { state: 'available' as const, data: UspVerticalContextSchema.parse({
    building: building.data, floor: floor.data, space: space.data,
  }) };
}

export function hasVerticalMembership(building: { kind: string; pin: TargetPin },
  floor: { kind: string; pin: TargetPin; relations: readonly { target: TargetPin }[] },
  space: { kind: string; relations: readonly { target: TargetPin }[] }) {
  const linked = (child: { relations: readonly { target: TargetPin }[] }, parent: TargetPin) =>
    child.relations.some(relation => canonical(relation.target) === canonical(parent));
  return building.kind === 'building' && floor.kind === 'floor' && space.kind === 'space'
    && linked(floor, building.pin) && linked(space, floor.pin);
}

function encodeCursor(data: object) {
  const body = Buffer.from(canonical(data)).toString('base64url');
  const tag = createHmac('sha256', settings.s3SecretKey).update(body).digest('base64url');
  return `${body}.${tag}`;
}
function decodeCursor(input: string): { manifestId: string; after: string; accessViewId: string; expires: number } {
  const [body, tag, extra] = input.split('.');
  if (!body || !tag || extra || input.length > 4096) throw new AppError(409, 'USP_CURSOR_REFRESH', 'Refresh this property list.');
  const expected = createHmac('sha256', settings.s3SecretKey).update(body).digest();
  const actual = Buffer.from(tag, 'base64url');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new AppError(409, 'USP_CURSOR_REFRESH', 'Refresh this property list.');
  try {
    const value = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (typeof value.manifestId !== 'string' || typeof value.after !== 'string'
      || typeof value.accessViewId !== 'string' || typeof value.expires !== 'number'
      || value.expires < Date.now()) throw new Error('expired');
    return value;
  } catch { throw new AppError(409, 'USP_CURSOR_REFRESH', 'Refresh this property list.'); }
}

export async function readRegistryScope(ctx: RequestContext, scope: SnapshotScope, cursor: string | null, limit: number) {
  const manifest = await readManifest(ctx, scope);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new AppError(400, 'USP_PAGE_LIMIT', 'Choose 1 to 100 records.');
  const decoded = cursor ? decodeCursor(cursor) : null;
  if (decoded && (decoded.manifestId !== manifest.id || decoded.accessViewId !== ctx.accessViewId)) {
    throw new AppError(409, 'USP_CURSOR_REFRESH', 'Refresh this property list.');
  }
  const pins = manifest.members.filter(member => member.pin.ref.namespace === 'registry_record').map(member => member.pin);
  const remaining = pins.filter(pin => !decoded || pin.ref.id > decoded.after);
  const selected = remaining.slice(0, limit);
  const items = [];
  for (const pin of selected) {
    const result = await resolveRegistryTarget(ctx, scope, pin);
    if (result.state !== 'available') throw new AppError(409, 'USP_MANIFEST_REFRESH', 'A snapshot member is unavailable.');
    items.push(result.data);
  }
  return UspScopePageSchema.parse({ items, manifestId: manifest.id, coverage: manifest.coverage,
    nextCursor: remaining.length > limit ? encodeCursor({ manifestId: manifest.id,
      after: selected.at(-1)!.ref.id, accessViewId: ctx.accessViewId, expires: Date.now() + 3600000 }) : null });
}

export async function readRegistryEvidence(ctx: RequestContext, scope: SnapshotScope, pointer: EvidencePointer, action: 'preview' | 'extract' | 'original') {
  await readManifest(ctx, scope);
  const targetPin = (await transaction(async client => (await client.query(
    `SELECT revision FROM usp_snapshot_bodies WHERE manifest_id=$1 AND namespace=$2 AND object_id=$3
     ORDER BY revision DESC LIMIT 1`, [scope.manifestId, pointer.target.namespace, pointer.target.id],
  )).rows[0]))?.revision;
  if (targetPin === undefined) return { state: 'unavailable' as const, reasonCode: 'target_not_in_snapshot' };
  const target = await resolveRegistryTarget(ctx, scope, { ref: pointer.target, revision: storedRevision(targetPin) });
  if (target.state !== 'available' || !target.data.evidence.some(e => canonical(e) === canonical(pointer))) {
    return { state: 'unavailable' as const, reasonCode: 'evidence_not_linked' };
  }
  if (action !== 'original') return { state: 'not_assessed' as const, reasonCode: 'safe_derivative_not_qualified' };
  const source = await memberBody(scope, pointer.sourceRevision);
  if (!source || fingerprint(source.body) !== source.body_sha256) return { state: 'unavailable' as const, reasonCode: 'unavailable_revision' };
  const row = source.body;
  if (row.revision !== pointer.sourceRevision.revision) return { state: 'unavailable' as const, reasonCode: 'unavailable_revision' };
  const data = UspAuthorizedAssetSchema.parse({
    asset: { assetId: row.id, version: row.revision, sha256: row.sha256 }, pointer, action,
    mediaType: row.mime_type, bytes: Number(row.bytes), disposition: 'attachment', accessViewId: ctx.accessViewId,
  });
  return { state: 'available' as const, data };
}

export async function readRegistryEvidenceBytes(ctx: RequestContext, scope: SnapshotScope, pointer: EvidencePointer) {
  const authorization = await readRegistryEvidence(ctx, scope, pointer, 'original');
  if (authorization.state !== 'available') throw new AppError(404, 'USP_EVIDENCE_UNAVAILABLE', 'The exact original is unavailable.');
  const source = await memberBody(scope, pointer.sourceRevision);
  if (!source) throw new AppError(404, 'USP_EVIDENCE_UNAVAILABLE', 'The exact original is unavailable.');
  const bytes = await readObject(source.body.object_key);
  if (bytes.length !== authorization.data.bytes || sha256(bytes) !== authorization.data.asset.sha256) {
    throw new AppError(422, 'USP_ORIGINAL_INTEGRITY', 'The retained original no longer matches its source receipt.');
  }
  return { bytes, authorization: authorization.data };
}
