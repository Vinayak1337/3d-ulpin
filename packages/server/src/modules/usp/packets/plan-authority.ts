import type { PoolClient } from 'pg';
import type { RequestContext, TargetPin, EvidencePointer } from '@ulpin/contracts/usp';
import type { PacketPlan, PacketPlanInput, PacketPlanEntry } from '../../../../../contracts/src/usp/packets';
import { UspPacketPlanEntrySchema } from '../../../../../contracts/src/usp/packets';
import { canonical, fingerprint } from '../../cases/domain';
import { AppError, conflict, notFound } from '../../../infrastructure/errors';
import { readObject, sha256 } from '../../../infrastructure/storage';
import { assertLocalUsp } from '../snapshots';
import { scopedManifestTx } from '../commands';
import { assertDeclarationEvidenceTx, assertPopulationTx, declarationEvidence, equalPin } from '../declarations/authority';
import { UspDeclarationInputSchema, UspReviewDeclarationSchema } from '@ulpin/contracts/usp';
import { selectExactPart, type Packet0Line } from '../packet0';
import { captureDocumentSourceTx } from '../ingestion/document-authority';
import { sharedKey, SharedAuthorityNeeded, type SharedAuthority } from './plan-shared';

async function capturedTx(client: PoolClient, manifestId: string, pin: TargetPin) {
  const row = (await client.query(`SELECT body,body_sha256 FROM usp_snapshot_bodies WHERE manifest_id=$1
    AND namespace=$2 AND object_id=$3 AND revision=$4`, [manifestId, pin.ref.namespace, pin.ref.id, pin.revision])).rows[0];
  if (!row || fingerprint(row.body) !== row.body_sha256) conflict('The exact captured context is unavailable.');
  return row as { body: Record<string, any>; body_sha256: string };
}
export function assertPlanActor(ctx: RequestContext, plan: PacketPlan) {
  assertLocalUsp(ctx);
  if (canonical(ctx.principal) !== canonical(plan.creator) || ctx.accessViewId !== plan.accessViewId
    || ctx.policyVersion !== plan.policyVersion)
    throw new AppError(403, 'PACKET_PLAN_ACCESS', 'Current access does not authorize this private plan.');
}
/** Historical disclosure checks current access, not current extraction/revision eligibility. */
export async function authorizePlanTx(client: PoolClient, ctx: RequestContext, plan: PacketPlan) {
  assertPlanActor(ctx, plan);
  await scopedManifestTx(client, ctx, plan.input.scope);
  const current = (await client.query(`SELECT r.*,c.status AS project_status FROM registry_records r
    LEFT JOIN usp_project_codes c ON c.record_id=r.id WHERE r.id=$1 AND r.site_id=$2`,
    [plan.input.target.ref.id, plan.input.scope.scopeId])).rows[0] ?? notFound('The selected target is unavailable.');
  if (['retired', 'cancelled_error'].includes(current.project_status))
    throw new AppError(403, 'PACKET_PLAN_TARGET_ACCESS', 'The selected target is unavailable.');
  await assertDeclarationEvidenceTx(client, ctx, plan.input.scope, plan.entries.map(e => ({
    pointer: { ...e.selection.pointer, assetRevision: null, partRevision: null }, sha256: e.sourceSha256, bytes: e.sourceBytes,
  })), false, 'replay');
  // Accepted shared context can depend on private contributing sources besides the selected excerpt.
  for (const entry of plan.entries) if (entry.applicabilitySha256 && entry.selection.review.kind === 'shared') {
    const selection = entry.selection;
    if (selection.review.kind !== 'shared') continue;
    const captured = await capturedTx(client, plan.input.scope.manifestId, selection.review.declaration);
    const input = UspDeclarationInputSchema.parse(captured.body.input), review = UspReviewDeclarationSchema.parse(captured.body.review);
    await assertDeclarationEvidenceTx(client, ctx, plan.input.scope,
      [...declarationEvidence(input), ...review.consentEvidence, ...review.applicability.map(a => a.evidence)], false, 'replay');
  }
  assertPlanActor(ctx, plan);
}
function samePart(a: EvidencePointer, b: EvidencePointer) {
  // Inherited inclusion changes origin only, never the reviewed locator/purpose/target metadata.
  return canonical({ ...a, origin: 'direct' }) === canonical({ ...b, origin: 'direct' });
}
/** Reuse accepted declaration eligibility, then protect its contributing pins on this transaction's client.
 * No packet policy broadens the declaration authority's declared_share purpose. */
async function sharedTx(client: PoolClient, ctx: RequestContext, input: PacketPlanInput,
  selection: PacketPlanInput['entries'][number], authority: SharedAuthority) {
  if (selection.review.kind !== 'shared') return null;
  if (input.purpose !== 'declared_share' || !selection.review.validAt) return null;
  const selected = authority.get(sharedKey(input, selection));
  if (!selected) return null;
  if (selected.packetState !== 'available' || selected.applicability?.purpose !== input.purpose
    || !['reviewed_evidence', 'not_required'].includes(selected.applicability.consentStatus)) return null;
  const allowed = [selected.entry?.evidence, selected.applicability.evidence].filter(e => e !== undefined);
  if (!allowed.some(e => samePart(e.pointer, selection.pointer))) return null;
  const captured = await capturedTx(client, input.scope.manifestId, selection.review.declaration);
  const declaration = UspDeclarationInputSchema.parse(captured.body.input), review = UspReviewDeclarationSchema.parse(captured.body.review);
  await assertDeclarationEvidenceTx(client, ctx, input.scope,
    [...declarationEvidence(declaration), ...review.consentEvidence, ...review.applicability.map(a => a.evidence)], true);
  await assertPopulationTx(client, input.scope.scopeId, [...declaration.population.targets,
    ...declaration.entries.map(e => e.target), ...(review.applicability.find(a => equalPin(a.target, input.target))?.relationPath ?? [])], true);
  const latest = (await client.query('SELECT revision FROM usp_declaration_revisions WHERE id=$1 ORDER BY revision DESC LIMIT 1',
    [selection.review.declaration.ref.id])).rows[0];
  if (!latest || latest.revision !== selection.review.declaration.revision) conflict('The shared applicability revision changed.');
  return fingerprint(selected);
}
export async function assessPlanTx(client: PoolClient, ctx: RequestContext, input: PacketPlanInput,
  readBytes: typeof readObject = readObject, shared?: SharedAuthority) {
  assertLocalUsp(ctx);
  const manifest = await scopedManifestTx(client, ctx, input.scope);
  if (manifest.selection.kind !== 'targets' || manifest.selection.pins.length !== 1
    || !equalPin(manifest.selection.pins[0], input.target))
    throw new AppError(422, 'PACKET_PLAN_SELECTION', 'Select one exact building, floor or space snapshot.');
  if (!shared && input.purpose === 'declared_share' && input.entries.some(e => e.review.kind === 'shared'
    && e.review.validAt && manifest.members.some(m => e.review.kind === 'shared' && equalPin(m.pin, e.review.declaration))))
    throw new SharedAuthorityNeeded(input);
  const captured = await capturedTx(client, input.scope.manifestId, input.target), target = captured.body;
  if (!['building', 'floor', 'space'].includes(target.kind))
    throw new AppError(422, 'PACKET_PLAN_TARGET', 'This recipe supports a selected building, floor or space.');
  await assertPopulationTx(client, input.scope.scopeId, [input.target], true);
  const current = (await client.query(`SELECT r.*,c.code AS project_code,c.status AS project_status,s.location AS project_location
    FROM registry_records r LEFT JOIN usp_project_codes c ON c.record_id=r.id
    LEFT JOIN usp_project_identity_state s ON s.record_id=r.id WHERE r.id=$1 AND r.site_id=$2 FOR SHARE OF r`,
    [input.target.ref.id, input.scope.scopeId])).rows[0];
  if (!current) conflict('The selected record context changed.');
  const aliases = (await client.query('SELECT alias FROM registry_aliases WHERE site_id=$1 AND record_id=$2 ORDER BY alias',
    [input.scope.scopeId, input.target.ref.id])).rows.map(r => r.alias);
  const successors = (await client.query(`SELECT successor_id FROM usp_project_lineage WHERE scope_id=$1 AND predecessor_id=$2
    AND kind IN ('split','merge') ORDER BY successor_id`, [input.scope.scopeId, input.target.ref.id])).rows.map(r => r.successor_id);
  const currentBody = { ...current, projectIdentity: current.project_code ? { code: current.project_code,
    status: current.project_status, location: current.project_location, successors } : null, historicalAliases: aliases };
  if (fingerprint(JSON.parse(JSON.stringify(currentBody))) !== captured.body_sha256) conflict('The selected record context changed.');
  const entries: PacketPlanEntry[] = [], lines: Packet0Line[] = [];
  const bindings = [...(target.body?.evidence ?? []), ...(target.body?.rights ?? [])
    .map((r: { evidence?: { sourceId: string; locator: string } }) => r.evidence).filter(Boolean)];
  let totalBytes = 0;
  const sources = new Map<string, Awaited<ReturnType<typeof capturedTx>>>();
  const verifiedBytes = new Set<string>();
  for (const selection of input.entries) {
    const pointer = selection.pointer;
    if (canonical(pointer.target) !== canonical(input.target.ref))
      throw new AppError(422, 'PACKET_PLAN_WRONG_TARGET', 'Every selected part must name this exact target.');
    const id = pointer.sourceRevision.ref.id;
    let source = sources.get(id);
    if (!source) {
      source = await capturedTx(client, input.scope.manifestId, pointer.sourceRevision); sources.set(id, source);
      totalBytes += Number(source.body.bytes);
      if (!Number.isSafeInteger(totalBytes) || totalBytes > 64 * 1024 * 1024)
        throw new AppError(413, 'PACKET_PLAN_SOURCE_LIMIT', 'The selected sources exceed the 64 MiB recipe bound.');
    }
    await assertDeclarationEvidenceTx(client, ctx, input.scope, [{
      pointer: { ...pointer, assetRevision: null, partRevision: null }, sha256: source.body.sha256, bytes: Number(source.body.bytes),
    }], true);
    // Reconstruct the existing capture projection, including exact imported parts.
    const live = (await client.query('SELECT * FROM sources WHERE id=$1 FOR SHARE', [id])).rows[0];
    const packages = (await client.query("SELECT body->'parts' AS parts FROM import_packages WHERE case_id=$1", [live.case_id])).rows;
    const parts = packages.flatMap(p => Array.isArray(p.parts) ? p.parts : [])
      .filter(p => p?.sourceRevisionId === id);
    const projection = await captureDocumentSourceTx(client, live, parts);
    if (fingerprint(JSON.parse(JSON.stringify(projection))) !== source.body_sha256)
      conflict('The selected source extraction context changed.');
    let reasonCode: string | null = null, applicabilitySha256: string | null = null;
    if (selection.review.kind === 'direct') {
      const locator = pointer.locator;
      const expected = locator.kind === 'verbatim' && bindings.some((b: { sourceId: string; locator: string }) =>
        b.sourceId === id && b.locator === locator.locator);
      if (!expected || locator.kind !== 'verbatim' || pointer.origin !== 'direct' || pointer.purpose !== 'record' || pointer.assetRevision || pointer.partRevision
        || pointer.legacyLocator !== locator.locator)
        throw new AppError(422, 'PACKET_PLAN_LINK', 'Use the exact record-backed evidence link.');
      if (!selection.review.reviewed) reasonCode = 'direct_applicability_unreviewed';
    } else {
      if (pointer.origin !== 'inherited') throw new AppError(422, 'PACKET_PLAN_LINK', 'Shared entries require explicit inherited applicability.');
      applicabilitySha256 = await sharedTx(client, ctx, input, selection, shared ?? new Map());
      if (!applicabilitySha256) reasonCode = 'shared_applicability_unavailable';
    }
    const locator = pointer.locator;
    const supported = !pointer.assetRevision && !pointer.partRevision && locator.kind === 'verbatim' && (
      source.body.profile === 'text-reference-v2' && /^line [1-9][0-9]*$/.test(locator.locator)
      || source.body.profile === 'csv-reference-v2' && /^CSV row [1-9][0-9]*$/.test(locator.locator));
    const excerpt = supported ? selectExactPart(source.body.inspection?.referenceParts, locator) : null;
    if (!reasonCode && excerpt === null) reasonCode = 'exact_extract_unavailable';
    if (!reasonCode && !verifiedBytes.has(id)) {
      const bytes = await readBytes(source.body.object_key);
      if (bytes.length !== Number(source.body.bytes) || sha256(bytes) !== source.body.sha256)
        throw new AppError(422, 'PACKET_PLAN_ORIGINAL_INTEGRITY', 'The selected original does not match its byte receipt.');
      verifiedBytes.add(id);
    }
    if (!reasonCode) lines.push({ pointer, sourceSha256: source.body.sha256, excerpt, reasonCode: null });
    const body = { selection, sourceSha256: source.body.sha256, sourceBytes: Number(source.body.bytes),
      sourceBodySha256: source.body_sha256, evidenceSha256: fingerprint(pointer),
      excerptSha256: !reasonCode && excerpt !== null ? sha256(excerpt) : null, targetPath: [input.target], applicabilitySha256,
      state: reasonCode ? selection.required ? 'blocked_required_context' : 'omitted_optional' : 'included', reasonCode };
    entries.push(UspPacketPlanEntrySchema.parse({ ...body, entrySha256: fingerprint(body) }));
  }
  assertLocalUsp(ctx);
  return { targetBodySha256: captured.body_sha256, targetLabel: target.body?.name ?? target.identifier,
    entries, requiredContext: entries.some(e => e.state === 'blocked_required_context') ? 'blocked' as const : 'available' as const, lines };
}
export function assertAssessment(plan: PacketPlan, assessment: Awaited<ReturnType<typeof assessPlanTx>>) {
  if (assessment.targetBodySha256 !== plan.targetBodySha256 || assessment.targetLabel !== plan.targetLabel
    || canonical(assessment.entries) !== canonical(plan.entries)) conflict('The exact plan context changed. Create a fresh selection.');
}
