import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import {
  AssignProjectCodeSchema, ProjectIdentityMutationSchema, ProjectIdentityReviewSchema,
  ProjectLocationSchema, ResolveProjectIdentitySchema, normalizeProjectCode,
  verticalLocator, type ProjectLocation, type RequestContext,
} from '@ulpin/contracts/usp';
import { transaction } from '../db';
import { canonical, fingerprint } from '../domain';
import { AppError, conflict, notFound } from '../errors';
import { appendUspOutboxTx, requestReceiptTx, scopedManifestTx } from './commands';
import { assertLocalUsp, captureRegistrySnapshotTx } from './snapshots';
import { newProjectCode } from './project-code-generator';

type Review = z.infer<typeof ProjectIdentityReviewSchema>;
type Assign = z.infer<typeof AssignProjectCodeSchema>;
type Mutation = z.infer<typeof ProjectIdentityMutationSchema>;
const unsupported = (): never => { throw new AppError(422, 'unsupported_lineage_kind', 'The requested lineage shape is unsupported.'); };

function officer(ctx: RequestContext) {
  assertLocalUsp(ctx);
  if (!ctx.principal.roles.includes('operator')) throw new AppError(403, 'USP_REVIEW_CAPABILITY', 'An authorized reviewer is required.');
}

async function lockRecording(client: PoolClient) {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('physical-area-recording',0))");
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('usp-project-code-namespace',0))");
}

async function pinnedManifest(client: PoolClient, ctx: RequestContext, scope: Assign['scope']) {
  const manifest = await scopedManifestTx(client, ctx, scope);
  const current = await captureRegistrySnapshotTx(client, ctx, scope.scopeId, manifest.selection);
  if (current.digest !== manifest.digest) conflict('The manifest changed. Capture and review a new snapshot.');
  return manifest;
}

async function lockedRecords(client: PoolClient, scopeId: string, ids: string[]) {
  const sorted = [...new Set(ids)].sort();
  if (sorted.length !== ids.length) unsupported();
  const rows = (await client.query(
    'SELECT id,site_id,kind,revision,body FROM registry_records WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',
    [sorted],
  )).rows;
  if (rows.length !== sorted.length || rows.some(row => row.site_id !== scopeId || row.kind !== 'space' || row.revision < 1)) {
    throw new AppError(422, 'USP_IDENTITY_TARGET', 'Every target must be an existing recorded space in this scope.');
  }
  return rows;
}

function validateMembers(manifest: Awaited<ReturnType<typeof scopedManifestTx>>,
  rows: { id: string; revision: number; body: any }[], versions: Record<string, number>, evidence: Review['evidence']) {
  const sourceIds = new Set(manifest.members.filter(member => member.pin.ref.namespace === 'source_revision')
    .map(member => member.pin.ref.id));
  if (!evidence.length || evidence.some(item => !sourceIds.has(item.sourceId))) {
    throw new AppError(422, 'USP_IDENTITY_EVIDENCE', 'Reviewed source evidence must belong to the exact snapshot.');
  }
  for (const row of rows) {
    if (row.revision !== versions[row.id] || !manifest.members.some(member =>
      member.pin.ref.namespace === 'registry_record' && member.pin.ref.id === row.id
      && member.pin.revision === row.revision)) conflict('The target version or membership changed.');
    if (!evidence.some(item => (row.body?.evidence ?? []).some((binding: { sourceId: string; locator: string }) =>
      binding.sourceId === item.sourceId && binding.locator === item.locator))) {
      throw new AppError(422, 'USP_IDENTITY_EVIDENCE', 'Each identity target needs matching recorded source evidence.');
    }
  }
}

function validateLocation(raw: ProjectLocation) {
  const location = ProjectLocationSchema.parse(raw);
  const seen = new Set<string>();
  for (const parcel of location.parcels) {
    if (seen.has(parcel.ulpin)) throw new AppError(422, 'USP_DUPLICATE_ANCHOR', 'A parcel assertion is duplicated.');
    seen.add(parcel.ulpin);
  }
  const primary = location.parcels.filter(parcel => parcel.reviewed && parcel.role === 'primary');
  if (primary.length > 1 || location.anchorState === 'reviewed_complete' && location.parcels.every(parcel => !parcel.reviewed)) {
    throw new AppError(422, 'USP_ANCHOR_STATE', 'The reviewed anchor state and assertions disagree.');
  }
  return location;
}

export async function prepareProjectIdentityReview(ctx: RequestContext, raw: Review) {
  officer(ctx);
  const review = ProjectIdentityReviewSchema.parse(raw);
  if (review.recordIds.length !== new Set(review.recordIds).size
    || Object.keys(review.expectedVersions).sort().join(',') !== [...review.recordIds].sort().join(',')) unsupported();
  if (review.location) validateLocation(review.location);
  if (review.location?.parcels.some(parcel => !review.evidence.some(item => item.sourceId === parcel.sourceId))) {
    throw new AppError(422, 'USP_ANCHOR_EVIDENCE', 'Each parcel association needs reviewed source evidence.');
  }
  if (review.operation === 'assign' && (review.recordIds.length !== 1 || !review.location)) unsupported();
  if (review.operation === 'correct' && (review.recordIds.length !== 1 || !review.location)) unsupported();
  if (review.operation === 'boundary_adjustment' && (review.recordIds.length !== 2
    || !review.transferredGeometry || !review.predecessors || !review.successors
    || review.predecessors.length !== 1 || review.successors.length !== 1)) unsupported();
  return transaction(async client => {
    await lockRecording(client);
    if (review.operation === 'boundary_adjustment') {
      let valid = false;
      try {
        const geometry = (await client.query(`SELECT ST_IsValid(g) AS valid,ST_IsEmpty(g) AS empty,
          ST_Area(g) AS area,GeometryType(g) AS kind FROM
          (SELECT ST_GeomFromGeoJSON($1) AS g) q`, [JSON.stringify(review.transferredGeometry)])).rows[0];
        valid = geometry.valid && !geometry.empty && Number(geometry.area) > 0
          && ['POLYGON', 'MULTIPOLYGON'].includes(geometry.kind);
      } catch { /* malformed reviewed geometry */ }
      if (!valid) throw new AppError(422, 'USP_BOUNDARY_GEOMETRY', 'The transferred geometry must be a valid area.');
    }
    const rows = await lockedRecords(client, review.scope.scopeId, review.recordIds);
    const manifest = await pinnedManifest(client, ctx, review.scope);
    validateMembers(manifest, rows, review.expectedVersions, review.evidence);
    const id = randomUUID();
    await client.query(`INSERT INTO usp_project_identity_reviews
      (id,scope_id,manifest_id,operation,command_hash,reviewer_subject,body)
      VALUES($1,$2,$3,$4,$5,$6,$7)`, [id, review.scope.scopeId, review.scope.manifestId,
      review.operation, fingerprint(review), ctx.principal.subject, review]);
    return { reviewId: id, commandSha256: fingerprint(review), expectedManifestId: review.scope.manifestId };
  });
}

async function checkedReview(client: PoolClient, ctx: RequestContext, reviewId: string,
  scope: Assign['scope'], operation: string, ids: string[], versions: Record<string, number>,
  predecessorIds?: string[], successorIds?: string[]) {
  const row = (await client.query('SELECT * FROM usp_project_identity_reviews WHERE id=$1 FOR UPDATE', [reviewId])).rows[0] ?? notFound();
  const review = ProjectIdentityReviewSchema.parse(row.body);
  if (row.command_hash !== fingerprint(review) || row.consumed_at
    || row.scope_id !== scope.scopeId || row.manifest_id !== scope.manifestId
    || row.reviewer_subject !== ctx.principal.subject || row.operation !== operation
    || canonical(review.scope) !== canonical(scope)
    || canonical([...review.recordIds].sort()) !== canonical([...ids].sort())
    || canonical(review.expectedVersions) !== canonical(versions)
    || predecessorIds && canonical(review.predecessors ?? []) !== canonical(predecessorIds)
    || successorIds && canonical(review.successors ?? []) !== canonical(successorIds)) {
    conflict('The review does not authorize these exact inputs.');
  }
  return review;
}

async function allocate(client: PoolClient, recordId: string, scopeId: string, reviewId: string,
  factory: () => string) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = factory();
    if (normalizeProjectCode(code) !== code) throw new AppError(503, 'USP_CODE_GENERATOR', 'The code generator returned an invalid code.');
    await client.query('SAVEPOINT usp_code_attempt');
    try {
      await client.query(`INSERT INTO usp_project_codes(code,record_id,scope_id,status,review_id)
        VALUES($1,$2,$3,'assigned',$4)`, [code, recordId, scopeId, reviewId]);
      await client.query('RELEASE SAVEPOINT usp_code_attempt');
      return code;
    } catch (error) {
      await client.query('ROLLBACK TO SAVEPOINT usp_code_attempt');
      await client.query('RELEASE SAVEPOINT usp_code_attempt');
      if ((error as { code?: string; constraint?: string }).code !== '23505'
        || (error as { constraint?: string }).constraint !== 'usp_project_codes_pkey') throw error;
    }
  }
  throw new AppError(503, 'USP_CODE_COLLISION', 'Unable to allocate an unused project code.');
}

async function bumpRevisions(client: PoolClient, scopeId: string, rows: { id: string; revision: number; body: any }[]) {
  const site = (await client.query('UPDATE registry_sites SET revision=revision+1 WHERE id=$1 RETURNING revision',
    [scopeId])).rows[0] ?? notFound();
  for (const row of rows) {
    const version = Number(row.revision) + 1;
    await client.query('UPDATE registry_records SET revision=$2 WHERE id=$1', [row.id, version]);
    await client.query(`INSERT INTO registry_revisions(record_id,revision,body,site_revision)
      VALUES($1,$2,$3,$4)`, [row.id, version, row.body, site.revision]);
  }
}

async function finish(client: PoolClient, ctx: RequestContext, scope: Assign['scope'],
  operation: string, requestKey: string, commandHash: string, reviewId: string,
  rows: { id: string; revision: number; body: any }[], details: object) {
  const before = rows.map(row => ({ recordId: row.id, revision: Number(row.revision) }));
  const after = before.map(row => ({ ...row, revision: row.revision + 1 }));
  const event = await appendUspOutboxTx(client, `registry:${scope.scopeId}`, {
    type: `project_identity.${operation}`, recordIds: rows.map(row => row.id), reviewId,
    correlationId: ctx.requestId,
  });
  const snapshot = await captureRegistrySnapshotTx(client, ctx, scope.scopeId, { kind: 'site' });
  const receipt = { receiptId: randomUUID(), operation: `project_identity_${operation}`,
    requestKey, commandSha256: commandHash, reviewId, before, after, details,
    snapshot: snapshot.scope, event, committedAt: new Date().toISOString() };
  await client.query(`INSERT INTO usp_project_identity_audit
    (id,scope_id,review_id,operation,record_ids,receipt_id,body) VALUES($1,$2,$3,$4,$5,$6,$7)`,
  [randomUUID(), scope.scopeId, reviewId, operation, rows.map(row => row.id), receipt.receiptId, receipt]);
  await client.query(`INSERT INTO usp_command_receipts
    (id,subject,scope_key,operation,request_key,command_sha256,body) VALUES($1,$2,$3,$4,$5,$6,$7)`,
  [receipt.receiptId, ctx.principal.subject, scope.scopeId, receipt.operation, requestKey, commandHash, receipt]);
  await client.query('UPDATE usp_project_identity_reviews SET consumed_at=now() WHERE id=$1', [reviewId]);
  return receipt;
}

export async function assignProjectCode(ctx: RequestContext, raw: Assign,
  codeFactory: () => string = newProjectCode, afterCodeInsert?: () => Promise<void>) {
  officer(ctx);
  const command = AssignProjectCodeSchema.parse(raw);
  if (command.expectedManifestId !== command.scope.manifestId) conflict('The expected manifest differs.');
  return transaction(async client => {
    await lockRecording(client);
    const operation = 'project_identity_assign', hash = fingerprint(command);
    const previous = await requestReceiptTx(client, ctx, command.scope.scopeId, operation, command.requestKey, hash);
    if (previous) return previous;
    const rows = await lockedRecords(client, command.scope.scopeId, [command.recordId]);
    const versions = { [command.recordId]: command.expectedRecordVersion };
    const review = await checkedReview(client, ctx, command.reviewId, command.scope, 'assign',
      [command.recordId], versions);
    const manifest = await pinnedManifest(client, ctx, command.scope);
    validateMembers(manifest, rows, versions, review.evidence);
    if ((await client.query('SELECT 1 FROM usp_project_codes WHERE record_id=$1', [command.recordId])).rowCount) {
      conflict('This space already has a reserved project code.');
    }
    const code = await allocate(client, command.recordId, command.scope.scopeId, command.reviewId, codeFactory);
    if (afterCodeInsert) await afterCodeInsert();
    await client.query(`INSERT INTO usp_project_identity_state(record_id,location,review_id,version)
      VALUES($1,$2,$3,$4)`, [command.recordId, validateLocation(review.location!), command.reviewId, rows[0].revision + 1]);
    await bumpRevisions(client, command.scope.scopeId, rows);
    return finish(client, ctx, command.scope, 'assign', command.requestKey, hash,
      command.reviewId, rows, { codes: { [command.recordId]: code } });
  });
}

function checkShape(command: Mutation) {
  const pre = command.predecessors, next = command.successors;
  const unique = new Set([...pre, ...next]);
  if (unique.size !== pre.length + next.length && command.operation !== 'boundary_adjustment') unsupported();
  if (command.operation === 'split' && pre.length === 1 && next.length >= 2) return;
  if (command.operation === 'merge' && pre.length >= 2 && next.length === 1) return;
  if (command.operation === 'boundary_adjustment' && pre.length === 1 && next.length === 1 && pre[0] !== next[0]) return;
  if (['correct', 'cancel', 'retire'].includes(command.operation) && pre.length === 1 && next.length === 0) return;
  unsupported();
}

export async function mutateProjectIdentity(ctx: RequestContext, raw: Mutation,
  codeFactory: () => string = newProjectCode) {
  officer(ctx);
  const command = ProjectIdentityMutationSchema.parse(raw);
  if (command.expectedManifestId !== command.scope.manifestId) conflict('The expected manifest differs.');
  checkShape(command);
  const ids = [...new Set([...command.predecessors, ...command.successors])].sort();
  if (Object.keys(command.expectedVersions).sort().join(',') !== ids.join(',')) unsupported();
  return transaction(async client => {
    await lockRecording(client);
    const operation = `project_identity_${command.operation}`, hash = fingerprint(command);
    const previous = await requestReceiptTx(client, ctx, command.scope.scopeId, operation, command.requestKey, hash);
    if (previous) return previous;
    const rows = await lockedRecords(client, command.scope.scopeId, ids);
    const review = await checkedReview(client, ctx, command.reviewId, command.scope, command.operation,
      ids, command.expectedVersions, command.predecessors, command.successors);
    const manifest = await pinnedManifest(client, ctx, command.scope);
    validateMembers(manifest, rows, command.expectedVersions, review.evidence);
    const statusRows = (await client.query('SELECT record_id,status FROM usp_project_codes WHERE record_id=ANY($1::uuid[])',
      [ids])).rows;
    const status = new Map(statusRows.map(row => [row.record_id as string, row.status as string]));
    for (const id of command.predecessors) {
      if (status.get(id) !== 'assigned') conflict('A predecessor is not an assigned continuing space.');
    }
    if (['split', 'merge'].includes(command.operation)) {
      for (const id of command.successors) if (status.has(id)) conflict('A successor already has a reserved code.');
    }
    const codes: Record<string, string> = {};
    if (command.operation === 'correct') {
      if (!review.location) unsupported();
      await client.query(`UPDATE usp_project_identity_state SET location=$2,review_id=$3,version=$4 WHERE record_id=$1`,
        [command.predecessors[0], validateLocation(review.location!), command.reviewId, rows[0].revision + 1]);
    } else if (command.operation === 'cancel' || command.operation === 'retire') {
      await client.query('UPDATE usp_project_codes SET status=$2,updated_at=now() WHERE record_id=$1',
        [command.predecessors[0], command.operation === 'cancel' ? 'cancelled_error' : 'retired']);
    } else if (command.operation === 'split' || command.operation === 'merge') {
      if (!review.location) unsupported();
      for (const id of command.predecessors) await client.query(
        "UPDATE usp_project_codes SET status='retired',updated_at=now() WHERE record_id=$1", [id]);
      for (const id of command.successors) {
        codes[id] = await allocate(client, id, command.scope.scopeId, command.reviewId, codeFactory);
        const row = rows.find(item => item.id === id)!;
        await client.query('INSERT INTO usp_project_identity_state(record_id,location,review_id,version) VALUES($1,$2,$3,$4)',
          [id, validateLocation(review.location!), command.reviewId, row.revision + 1]);
      }
      for (const prior of command.predecessors) for (const next of command.successors) await client.query(
        `INSERT INTO usp_project_lineage(id,scope_id,kind,predecessor_id,successor_id,review_id,evidence)
         VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [randomUUID(), command.scope.scopeId, command.operation, prior, next, command.reviewId, review.evidence]);
    } else {
      if (!review.transferredGeometry) unsupported();
      const [prior, next] = [command.predecessors[0], command.successors[0]];
      const cycle = (await client.query(`WITH RECURSIVE walk(id) AS (
        SELECT successor_id FROM usp_project_lineage WHERE predecessor_id=$1
        UNION SELECT l.successor_id FROM usp_project_lineage l JOIN walk w ON l.predecessor_id=w.id
      ) SELECT 1 FROM walk WHERE id=$2 LIMIT 1`, [next, prior])).rowCount;
      if (cycle) unsupported();
      await client.query(`INSERT INTO usp_project_lineage
        (id,scope_id,kind,predecessor_id,successor_id,review_id,evidence,transferred_geometry)
        VALUES($1,$2,'boundary_adjustment',$3,$4,$5,$6,$7)`,
      [randomUUID(), command.scope.scopeId, prior, next, command.reviewId,
        review.evidence, review.transferredGeometry]);
    }
    await bumpRevisions(client, command.scope.scopeId, rows);
    return finish(client, ctx, command.scope, command.operation, command.requestKey, hash,
      command.reviewId, rows, { codes });
  });
}

export async function resolveProjectIdentity(ctx: RequestContext, raw: z.infer<typeof ResolveProjectIdentitySchema>) {
  officer(ctx);
  const input = ResolveProjectIdentitySchema.parse(raw);
  if (input.identifier.includes('/') || input.identifier.includes(' / ')) {
    throw new AppError(422, 'locator_not_an_identifier', 'A location line is not an identifier.');
  }
  const code = normalizeProjectCode(input.identifier);
  if (input.identifier.toUpperCase().startsWith('P3') && !code) {
    throw new AppError(422, 'USP_CODE_INVALID', 'The project code is invalid.');
  }
  return transaction(async client => {
    const manifest = await scopedManifestTx(client, ctx, input.scope);
    const row = (await client.query(`SELECT c.code,c.status,c.record_id,r.revision,r.identifier,s.location
      FROM registry_records r JOIN usp_project_codes c ON c.record_id=r.id
      JOIN usp_project_identity_state s ON s.record_id=r.id
      WHERE c.scope_id=$1 AND (c.code=$2 OR r.id::text=$3 OR r.identifier=$3
        OR r.id IN (SELECT record_id FROM registry_aliases WHERE alias=$3))`,
      [input.scope.scopeId, code ?? '', input.identifier])).rows[0] ?? notFound();
    if (!manifest.members.some(member => member.pin.ref.namespace === 'registry_record'
      && member.pin.ref.id === row.record_id)) throw new AppError(403, 'USP_IDENTITY_SCOPE', 'The record is outside this authorized scope.');
    const successors = (await client.query(`SELECT successor_id FROM usp_project_lineage
      WHERE predecessor_id=$1 ORDER BY successor_id`, [row.record_id])).rows.map(item => item.successor_id);
    return { recordId: row.record_id, projectCode: row.code, profile: 'P3/1', status: row.status,
      recordVersion: row.revision, registryIdentifier: row.identifier,
      location: verticalLocator(ProjectLocationSchema.parse(row.location)), successors };
  });
}
