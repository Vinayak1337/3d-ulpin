import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import {
  DECLARATION_ACKNOWLEDGEMENT, UspDeclarationInputSchema, UspDeclarationChangeSchema,
  UspDeclarationProposalResultSchema, UspDeclarationReviewResultSchema, UspReviewDeclarationSchema,
  UspDeclarationCommitReceiptSchema, UspReadDeclarationSchema, UspSelectedDeclarationSchema,
  UspDeclarationDraftSchema, UspReadDeclarationProposalSchema,
  type RequestContext, type SnapshotScope, type SnapshotManifest, type PrepareProposal, type CommitProposal,
  type ReviewDeclaration, type TargetPin,
} from '@ulpin/contracts/usp';
import { transaction } from '../../../infrastructure/db';
import { AppError, conflict, notFound } from '../../../infrastructure/errors';
import { canonical, fingerprint } from '../../cases/domain';
import { assertLocalUsp, readManifest } from '../snapshots';
import { appendUspOutboxTx } from '../outbox';
import { assessDeclaration, targetKey, parseLiteralRational, fraction, rationalWire } from './arithmetic';
import { assertDeclarationEvidenceTx, assertPopulationTx, declarationEvidence, equalPin, lockDeclarationSiteTx, lockDeclarationFenceTx } from './authority';
import type { DeclarationBody } from './projection';

type Change = z.infer<typeof UspDeclarationChangeSchema>;
export type DeclarationCommandPorts = {
  manifest: (client: PoolClient, ctx: RequestContext, scope: SnapshotScope) => Promise<SnapshotManifest>;
  capture: (client: PoolClient, ctx: RequestContext, siteId: string, selection: SnapshotManifest['selection']) => Promise<SnapshotManifest>;
  receipt: (client: PoolClient, ctx: RequestContext, scopeKey: string, operation: string, requestKey: string, hash: string) => Promise<any>;
};
const unsupported = (message: string): never => { throw new AppError(422, 'DECLARATION_PROFILE', message); };
async function saveReceipt(client: PoolClient, ctx: RequestContext, scope: SnapshotScope, operation: string,
  requestKey: string, hash: string, body: object, id = randomUUID()) {
  await client.query(`INSERT INTO usp_command_receipts(id,subject,scope_key,operation,request_key,command_sha256,body)
    VALUES($1,$2,$3,$4,$5,$6,$7)`, [id, ctx.principal.subject, scope.scopeId, operation, requestKey, hash, body]);
}
async function fresh(client: PoolClient, ctx: RequestContext, scope: SnapshotScope, ports: DeclarationCommandPorts) {
  const manifest = await ports.manifest(client, ctx, scope);
  const current = await ports.capture(client, ctx, scope.scopeId, manifest.selection);
  if (current.digest !== manifest.digest) conflict('Source, population or declaration revisions changed. Capture a fresh snapshot.');
  return manifest;
}
function executable(change: Change) {
  if (!change.payload) unsupported('The declaration needs its source-defined population and share entries.');
  const input = UspDeclarationInputSchema.parse(change.payload);
  z.uuid().parse(change.declaration.ref.id);
  if (change.declaration.revision > 2147483647) unsupported('The declaration revision exceeds the storage profile.');
  for (const e of input.entries) z.uuid().parse(e.pin.ref.id);
  for (const p of input.population.targets) z.uuid().parse(p.ref.id);
  if (change.applicability.length) unsupported('Applicability is established by the explicit review operation.');
  if (!equalPin(change.instrument, input.instrument.pointer.sourceRevision)
    || canonical(change.entries) !== canonical(input.entries.map(e => e.pin))) conflict('Entry and instrument revision pins must match the supplied source-defined input.');
  if (input.entries.some(e => e.pin.revision !== change.declaration.revision)) unsupported('Entry revisions must match the new declaration revision.');
  for (const e of declarationEvidence(input)) if (!equalPin(e.pointer.sourceRevision, change.instrument))
    unsupported('This profile uses one instrument revision for the population, denominator and entries.');
  for (const e of [input.instrument, input.population.evidence, input.denominator.evidence])
    if (canonical(e.pointer.target) !== canonical(change.declaration.ref)) conflict('Instrument, population and denominator citations must pin their declaration.');
  for (const e of input.entries) if (canonical(e.evidence.pointer.target) !== canonical(e.target.ref))
    conflict('Each entry citation must identify its exact target.');
  for (const e of input.entries) if (/^(0|[1-9][0-9]*)(\.[0-9]+)?%$/.test(e.literalShare)) {
    const literal = parseLiteralRational(e.literalShare);
    if (canonical(rationalWire(fraction(e.fraction))) !== canonical({ numerator: literal.numerator, denominator: literal.denominator }))
      unsupported('A literal percentage and its supplied exact fraction disagree.');
  }
  const assessment = assessDeclaration(input);
  if (input.population.status === 'complete' && (assessment.missingCount || assessment.ambiguousCount
    || assessment.reasonCodes.includes('declared_count_mismatch') || input.population.declaredCount === null))
    unsupported('A complete population must enumerate each member once; preserve incomplete or conflicting status instead.');
  return { input, assessment };
}
async function priorRevisionTx(client: PoolClient, siteId: string, change: Change) {
  const prior = (await client.query(`SELECT site_id,revision,body FROM usp_declaration_revisions WHERE id=$1
    ORDER BY revision DESC LIMIT 1`, [change.declaration.ref.id])).rows[0];
  if (change.action === 'create') {
    if (prior || change.declaration.revision !== 1) conflict('A new declaration must start at revision one.');
  } else {
    if (!prior || prior.site_id !== siteId || prior.revision !== change.supersedes?.revision
      || change.declaration.revision !== prior.revision + 1) conflict('The amendment must supersede the exact latest revision.');
    const old = prior.body as DeclarationBody;
    const input = change.payload!;
    if (old.input.allocationSubject !== input.allocationSubject || old.input.subjectDefinition !== input.subjectDefinition
      || old.input.jurisdiction !== input.jurisdiction) unsupported('A different allocation subject or jurisdiction needs a separate declaration.');
    if (!input.validity.from || !old.input.validity.from || input.validity.from < old.input.validity.from)
      unsupported('An amendment needs a stated effective date at or after its predecessor.');
  }
  // A stable entry UUID may be reused only within this declaration, for the same target identity.
  for (const e of change.payload!.entries) {
    const previous = (await client.query('SELECT declaration_id,body FROM usp_declaration_entries WHERE id=$1 ORDER BY revision DESC LIMIT 1', [e.pin.ref.id])).rows[0];
    if (previous && (previous.declaration_id !== change.declaration.ref.id
      || canonical(previous.body.entry.target.ref) !== canonical(e.target.ref))) conflict('A share entry identity is already assigned to another member.');
  }
}
async function validateTx(client: PoolClient, ctx: RequestContext, scope: SnapshotScope, change: Change, manifest: SnapshotManifest) {
  const { input, assessment } = executable(change);
  for (const p of [...input.population.targets, ...input.entries.map(e => e.target)])
    if (!manifest.members.some(m => equalPin(m.pin, p))) conflict('A population target is not in this snapshot.');
  await priorRevisionTx(client, scope.scopeId, change);
  await assertPopulationTx(client, scope.scopeId, [...input.population.targets, ...input.entries.map(e => e.target)], true);
  await assertDeclarationEvidenceTx(client, ctx, scope, declarationEvidence(input), true);
  return { input, assessment };
}
export async function prepareDeclarationTx(client: PoolClient, ctx: RequestContext, command: PrepareProposal, ports: DeclarationCommandPorts) {
  assertLocalUsp(ctx);
  if (command.kind !== 'declaration' || command.changes.length !== 1 || command.changes[0].kind !== 'declaration'
    || command.guard.mode !== 'create') unsupported('Prepare one declaration revision with a create guard.');
  const change = command.changes[0] as Change;
  const hash = fingerprint(command), operation = 'prepare_declaration';
  await lockDeclarationSiteTx(client, command.scope.scopeId);
  const previous = await ports.receipt(client, ctx, command.scope.scopeId, operation, command.guard.requestKey, hash);
  if (previous) {
    const receipt = UspDeclarationProposalResultSchema.parse(previous);
    await authorizeReceiptTx(client, ctx, command.scope, receipt.proposalId, ports);
    return receipt;
  }
  await lockDeclarationFenceTx(client, command.scope.scopeId);
  const manifest = await fresh(client, ctx, command.scope, ports);
  if (manifest.selection.kind !== 'targets') unsupported('Declaration preparation requires explicit population selection.');
  const { input, assessment } = await validateTx(client, ctx, command.scope, change, manifest);
  if (command.evidence.some(e => !declarationEvidence(input).some(source => canonical(source.pointer) === canonical(e))))
    unsupported('Additional evidence must match the declaration input receipts.');
  const selected = 'target' in command ? [command.target] : command.targets;
  const population = [...new Set([...input.population.targets, ...input.entries.map(e => e.target)].map(targetKey))].sort();
  if (canonical(selected.map(targetKey).sort()) !== canonical(population)) unsupported('The explicit proposal selection must cover exactly its population and supplied entries.');
  if (selected.some(p => !manifest.members.some(m => equalPin(m.pin, p)))) conflict('A selected target changed.');
  const result = UspDeclarationProposalResultSchema.parse({ proposalId: randomUUID(), version: 1, state: 'draft', assessment });
  await client.query(`INSERT INTO usp_declaration_proposals(id,site_id,manifest_id,subject,version,body)
    VALUES($1,$2,$3,$4,1,$5)`, [result.proposalId, command.scope.scopeId, command.scope.manifestId, ctx.principal.subject,
      { command, assessment }]);
  await appendUspOutboxTx(client, `registry:${command.scope.scopeId}`, { type: 'proposal.prepared', scope: command.scope,
    proposalId: result.proposalId, kind: 'declaration', correlationId: ctx.requestId });
  await saveReceipt(client, ctx, command.scope, operation, command.guard.requestKey, hash, result);
  return result;
}
async function proposalTx(client: PoolClient, ctx: RequestContext, scope: SnapshotScope, proposalId: string) {
  z.uuid().parse(proposalId);
  const proposal = (await client.query('SELECT * FROM usp_declaration_proposals WHERE id=$1 AND site_id=$2', [proposalId, scope.scopeId])).rows[0] ?? notFound();
  if (proposal.subject !== ctx.principal.subject || canonical(proposal.body.command.scope) !== canonical(scope))
    throw new AppError(403, 'DECLARATION_PROPOSAL_DENIED', 'The proposal is unavailable in this access context.');
  const change = UspDeclarationChangeSchema.parse(proposal.body.command.changes[0]);
  return { proposal, change };
}
/** Reauthorize retained inputs, including a later immutable review, without
 * capturing a new snapshot, reassessing shares or reexecuting the operation. */
async function authorizeReceiptTx(client: PoolClient, ctx: RequestContext, scope: SnapshotScope,
  proposalId: string, ports: DeclarationCommandPorts, requiredReviewId?: string) {
  await ports.manifest(client, ctx, scope);
  const { change } = await proposalTx(client, ctx, scope, proposalId);
  const input = UspDeclarationInputSchema.parse(change.payload);
  const reviewRow = (await client.query('SELECT * FROM usp_declaration_reviews WHERE proposal_id=$1 AND site_id=$2',
    [proposalId, scope.scopeId])).rows[0];
  if (requiredReviewId && reviewRow?.id !== requiredReviewId) notFound('The retained review is unavailable.');
  const review = reviewRow ? UspReviewDeclarationSchema.parse(reviewRow.body.command) : null;
  if (reviewRow && (reviewRow.subject !== ctx.principal.subject || review!.proposalId !== proposalId
    || canonical(review!.scope) !== canonical(scope)))
    throw new AppError(403, 'DECLARATION_REVIEW_DENIED', 'The retained review is unavailable in this access context.');
  await assertDeclarationEvidenceTx(client, ctx, scope, [...declarationEvidence(input),
    ...(review?.consentEvidence ?? []), ...(review?.applicability.map(a => a.evidence) ?? [])], true, 'replay');
  assertLocalUsp(ctx);
}
export async function reviewDeclarationTx(client: PoolClient, ctx: RequestContext, raw: ReviewDeclaration, ports: DeclarationCommandPorts) {
  assertLocalUsp(ctx);
  const command = UspReviewDeclarationSchema.parse(raw);
  if (command.guard.expectedVersion !== 1 || command.guard.expectedManifestId !== command.scope.manifestId) conflict('Refresh the exact proposal snapshot.');
  const hash = fingerprint(command), operation = 'review_declaration';
  await lockDeclarationSiteTx(client, command.scope.scopeId);
  const previous = await ports.receipt(client, ctx, command.scope.scopeId, operation, command.guard.requestKey, hash);
  if (previous) {
    const receipt = UspDeclarationReviewResultSchema.parse(previous);
    await authorizeReceiptTx(client, ctx, command.scope, receipt.proposalId, ports, receipt.reviewId);
    return receipt;
  }
  await lockDeclarationFenceTx(client, command.scope.scopeId);
  if ((await client.query('SELECT id FROM usp_declaration_reviews WHERE proposal_id=$1', [command.proposalId])).rowCount)
    conflict('This proposal already has an immutable review. Prepare a new proposal to revise the decision.');
  const manifest = await fresh(client, ctx, command.scope, ports);
  const { change } = await proposalTx(client, ctx, command.scope, command.proposalId);
  const { input, assessment } = await validateTx(client, ctx, command.scope, change, manifest);
  if (assessment.state !== command.assessmentState) conflict('Acknowledge the exact arithmetic and population assessment.');
  if ((await client.query('SELECT 1 FROM usp_declaration_commit_links WHERE proposal_id=$1', [command.proposalId])).rowCount) conflict('The proposal was already accepted.');
  const seen = new Set<string>();
  for (const a of command.applicability) {
    if (seen.has(targetKey(a.target))) unsupported('One applicability decision per exact target is supported.');
    seen.add(targetKey(a.target));
    if (!input.entries.some(e => equalPin(e.target, a.target))
      || canonical(a.evidence.pointer.target) !== canonical(a.target.ref)) conflict('Applicability must identify a supplied entry and its exact target.');
    for (const p of a.relationPath) if (!manifest.members.some(m => equalPin(m.pin, p))) conflict('An applicability path endpoint changed.');
    if (a.state === 'applicable' && (assessment.ambiguousCount || !a.validity.from || !input.validity.from))
      unsupported('Applicable clauses need an unambiguous member and stated effective dates.');
  }
  await assertPopulationTx(client, command.scope.scopeId, command.applicability.flatMap(a => a.relationPath), true);
  await assertDeclarationEvidenceTx(client, ctx, command.scope,
    [...command.consentEvidence, ...command.applicability.map(a => a.evidence)], true);
  const result = UspDeclarationReviewResultSchema.parse({ reviewId: randomUUID(), proposalId: command.proposalId,
    version: 1, state: 'reviewed', assessment });
  await client.query(`INSERT INTO usp_declaration_reviews(id,proposal_id,site_id,subject,body)
    VALUES($1,$2,$3,$4,$5)`, [result.reviewId, command.proposalId, command.scope.scopeId, ctx.principal.subject, { command, assessment }]);
  await appendUspOutboxTx(client, `registry:${command.scope.scopeId}`, { type: 'declaration.reviewed', scope: command.scope,
    proposalId: command.proposalId, reviewId: result.reviewId, correlationId: ctx.requestId });
  await saveReceipt(client, ctx, command.scope, operation, command.guard.requestKey, hash, result);
  return result;
}
export async function commitDeclarationTx(client: PoolClient, ctx: RequestContext, command: CommitProposal, ports: DeclarationCommandPorts) {
  assertLocalUsp(ctx);
  z.uuid().parse(command.proposalId);
  z.uuid().parse(command.reviewId);
  if (command.kind !== 'declaration' || command.guard.mode !== 'update'
    || command.guard.expectedVersion !== 1 || command.guard.expectedManifestId !== command.scope.manifestId
    || command.acknowledgement !== DECLARATION_ACKNOWLEDGEMENT) unsupported('Technical acceptance requires the exact reviewed proposal and acknowledgement.');
  const hash = fingerprint(command), operation = 'commit_declaration';
  await lockDeclarationSiteTx(client, command.scope.scopeId);
  const previous = await ports.receipt(client, ctx, command.scope.scopeId, operation, command.guard.requestKey, hash);
  if (previous) {
    const receipt = UspDeclarationCommitReceiptSchema.parse(previous);
    await authorizeReceiptTx(client, ctx, command.scope, receipt.proposalId, ports, receipt.reviewId);
    return receipt;
  }
  await lockDeclarationFenceTx(client, command.scope.scopeId);
  const manifest = await fresh(client, ctx, command.scope, ports);
  const { change } = await proposalTx(client, ctx, command.scope, command.proposalId);
  const reviewRow = (await client.query('SELECT * FROM usp_declaration_reviews WHERE id=$1 AND proposal_id=$2 AND site_id=$3',
    [command.reviewId, command.proposalId, command.scope.scopeId])).rows[0] ?? notFound();
  if (reviewRow.subject !== ctx.principal.subject) throw new AppError(403, 'DECLARATION_REVIEW_DENIED', 'The review is unavailable.');
  const review = UspReviewDeclarationSchema.parse(reviewRow.body.command);
  if (canonical(review.scope) !== canonical(command.scope) || review.guard.expectedVersion !== 1)
    conflict('The exact review snapshot or proposal version changed.');
  const { input, assessment } = await validateTx(client, ctx, command.scope, change, manifest);
  if (canonical(assessment) !== canonical(reviewRow.body.assessment) || assessment.state !== review.assessmentState) conflict('The reviewed assessment changed.');
  if ((await client.query('SELECT 1 FROM usp_declaration_commit_links WHERE proposal_id=$1 OR review_id=$2', [command.proposalId, command.reviewId])).rowCount)
    conflict('This proposal or review was already accepted.');
  await assertPopulationTx(client, command.scope.scopeId, review.applicability.flatMap(a => a.relationPath), true);
  await assertDeclarationEvidenceTx(client, ctx, command.scope, [...review.consentEvidence, ...review.applicability.map(a => a.evidence)], true);
  const body: DeclarationBody = { pin: change.declaration, input, assessment, supersedes: change.supersedes,
    review, technicalStatus: 'technically_accepted', legalStatus: 'not_assessed' };
  const receiptId = randomUUID();
  await client.query('UPDATE usp_declaration_scope_fences SET fence=fence+1 WHERE site_id=$1', [command.scope.scopeId]);
  await client.query(`INSERT INTO usp_declaration_revisions(id,revision,site_id,proposal_id,review_id,body)
    VALUES($1,$2,$3,$4,$5,$6)`, [change.declaration.ref.id, change.declaration.revision, command.scope.scopeId,
      command.proposalId, command.reviewId, body]);
  const after: TargetPin[] = [change.declaration];
  for (const entry of input.entries) {
    const entryBody = { pin: entry.pin, declaration: change.declaration, entry, technicalStatus: 'technically_accepted' };
    await client.query(`INSERT INTO usp_declaration_entries(id,revision,declaration_id,declaration_revision,body)
      VALUES($1,$2,$3,$4,$5)`, [entry.pin.ref.id, entry.pin.revision, change.declaration.ref.id, change.declaration.revision, entryBody]);
    after.push(entry.pin);
  }
  for (const a of review.applicability) {
    const pin = { ref: { namespace: 'applicability', id: randomUUID() }, revision: 1 };
    const consentStatus = change.action === 'amend' ? (review.consentEvidence.length ? 'reviewed_evidence' : 'not_assessed') : 'not_required';
    const app = { ...a, pin, declaration: change.declaration, consentStatus,
      state: consentStatus === 'not_assessed' && a.state === 'applicable' ? 'not_assessed' : a.state,
      reason: consentStatus === 'not_assessed' ? 'Amendment consent evidence is not assessed.' : a.reason,
      reviewer: ctx.principal.subject, policyVersion: ctx.policyVersion };
    await client.query(`INSERT INTO usp_declaration_applicability(id,revision,declaration_id,declaration_revision,body)
      VALUES($1,$2,$3,$4,$5)`, [pin.ref.id, pin.revision, change.declaration.ref.id, change.declaration.revision, app]);
    after.push(pin);
  }
  await client.query(`INSERT INTO usp_declaration_commit_links(proposal_id,review_id,receipt_id,declaration_id,declaration_revision)
    VALUES($1,$2,$3,$4,$5)`, [command.proposalId, command.reviewId, receiptId, change.declaration.ref.id, change.declaration.revision]);
  // Accepted revision, child writes, post-write snapshot, outbox and receipt all
  // use the caller's PoolClient. Any failure rolls the whole transaction back.
  const resulting = await ports.capture(client, ctx, command.scope.scopeId, manifest.selection);
  await assertDeclarationEvidenceTx(client, ctx, command.scope,
    [...declarationEvidence(input), ...review.consentEvidence, ...review.applicability.map(a => a.evidence)], true);
  assertLocalUsp(ctx);
  const event = await appendUspOutboxTx(client, `registry:${command.scope.scopeId}`, { type: 'declaration.accepted',
    scope: resulting.scope, proposalId: command.proposalId, reviewId: command.reviewId, declaration: change.declaration, correlationId: ctx.requestId });
  const receipt = UspDeclarationCommitReceiptSchema.parse({ receiptId, operation, kind: 'declaration', requestKey: command.guard.requestKey,
    commandSha256: hash, proposalId: command.proposalId, reviewId: command.reviewId,
    before: change.supersedes ? [change.supersedes] : [], after, snapshot: resulting.scope, event,
    committedAt: new Date().toISOString(), technicalStatus: 'technically_accepted', legalStatus: 'not_assessed' });
  await saveReceipt(client, ctx, command.scope, operation, command.guard.requestKey, hash, receipt, receiptId);
  return receipt;
}

export async function readDeclarationProposal(ctx: RequestContext, raw: z.infer<typeof UspReadDeclarationProposalSchema>) {
  assertLocalUsp(ctx);
  const command = UspReadDeclarationProposalSchema.parse(raw);
  const manifest = await readManifest(ctx, command.scope);
  return transaction(async client => {
    const { change } = await proposalTx(client, ctx, command.scope, command.proposalId);
    const { input, assessment } = executable(change);
    const selected = manifest.selection.kind === 'targets' ? manifest.selection.pins : [];
    if (!input.population.targets.every(p => selected.some(s => equalPin(s, p)))) unsupported('Draft inspection requires explicit population selection.');
    await assertDeclarationEvidenceTx(client, ctx, command.scope, declarationEvidence(input), false);
    const accepted = Boolean((await client.query('SELECT 1 FROM usp_declaration_commit_links WHERE proposal_id=$1', [command.proposalId])).rowCount);
    const review = (await client.query('SELECT id FROM usp_declaration_reviews WHERE proposal_id=$1', [command.proposalId])).rows[0];
    return UspDeclarationDraftSchema.parse({ proposalId: command.proposalId, version: 1,
      state: accepted ? 'technically_accepted' : review ? 'reviewed' : 'draft', reviewId: review?.id ?? null,
      declaration: change.declaration, supersedes: change.supersedes, input, assessment });
  });
}
function within(date: string, validity: { from: string | null; to: string | null; endState: string }) {
  return validity.from !== null && date >= validity.from && (validity.endState === 'open_ended'
    || validity.endState === 'stated' && validity.to !== null && date <= validity.to);
}
export async function readSelectedDeclaration(ctx: RequestContext, raw: z.infer<typeof UspReadDeclarationSchema>) {
  assertLocalUsp(ctx);
  const command = UspReadDeclarationSchema.parse(raw);
  const manifest = await readManifest(ctx, command.scope);
  if (manifest.selection.kind !== 'targets' || !manifest.selection.pins.some(p => equalPin(p, command.target))
    || !manifest.members.some(m => equalPin(m.pin, command.declaration))) unsupported('Select the exact target and captured declaration revision.');
  return transaction(async client => {
    const captured = (await client.query(`SELECT body,body_sha256 FROM usp_snapshot_bodies
      WHERE manifest_id=$1 AND namespace='declaration' AND object_id=$2 AND revision=$3`,
      [command.scope.manifestId, command.declaration.ref.id, command.declaration.revision])).rows[0] ?? notFound();
    if (fingerprint(captured.body) !== captured.body_sha256) conflict('The captured declaration failed its integrity check.');
    const body = captured.body as DeclarationBody;
    const input = UspDeclarationInputSchema.parse(body.input), review = UspReviewDeclarationSchema.parse(body.review);
    await assertDeclarationEvidenceTx(client, ctx, command.scope,
      [...declarationEvidence(input), ...review.consentEvidence, ...review.applicability.map(a => a.evidence)], false);
    const entries = input.entries.filter(e => equalPin(e.target, command.target));
    if (!entries.length && !input.population.targets.some(p => equalPin(p, command.target)))
      notFound('The selected target has no declaration membership.');
    const entry = entries.length === 1 ? entries[0] : null;
    const dependencies = [...input.population.targets, ...input.entries.map(e => e.target),
      ...(review.applicability.find(a => equalPin(a.target, command.target))?.relationPath ?? [])];
    let current = dependencies.every(p => manifest.members.some(m => equalPin(m.pin, p)));
    const entryRows = (await client.query(`SELECT body,body_sha256 FROM usp_snapshot_bodies
      WHERE manifest_id=$1 AND namespace='declaration_entry' ORDER BY object_id LIMIT 1001`, [command.scope.manifestId])).rows;
    if (entryRows.length > 1000) unsupported('The share entry context exceeds this profile.');
    for (const e of input.entries) {
      const member = entryRows.find(row => equalPin(row.body.pin, e.pin) && equalPin(row.body.declaration, command.declaration));
      const captured = manifest.members.some(m => equalPin(m.pin, e.pin));
      if (!member || !captured) {
        if (entry && equalPin(e.pin, entry.pin)) conflict('The exact captured share entry is unavailable.');
        current = false;
      } else if (fingerprint(member.body) !== member.body_sha256 || canonical(member.body.entry) !== canonical(e))
        conflict('The exact captured allocation entry is unavailable.');
    }
    const appRows = (await client.query(`SELECT body,body_sha256 FROM usp_snapshot_bodies WHERE manifest_id=$1
      AND namespace='applicability' ORDER BY object_id`, [command.scope.manifestId])).rows;
    if (appRows.length > 1000) unsupported('The applicability context exceeds this profile.');
    for (const a of appRows) if (fingerprint(a.body) !== a.body_sha256) conflict('The captured applicability failed its integrity check.');
    const apps = appRows.map(a => a.body).filter(a => equalPin(a.declaration, command.declaration) && equalPin(a.target, command.target));
    const app = apps.length === 1 ? apps[0] : null;
    // The assessment/entry remain the immutable historical allocation. Packet
    // eligibility additionally requires its whole population to be current.
    try { await assertPopulationTx(client, command.scope.scopeId, dependencies, false); }
    catch (error) { if (!(error instanceof AppError) || error.status !== 409) throw error; current = false; }
    // A retained older card still reads its exact revision. It cannot claim
    // applicability after a later recorded amendment's stated effective date.
    const later = (await client.query(`SELECT body FROM usp_declaration_revisions WHERE id=$1 AND revision>$2
      ORDER BY revision LIMIT 10`, [command.declaration.ref.id, command.declaration.revision])).rows;
    const supersededAt = later.some(r => !r.body.input.validity.from || command.validAt && command.validAt >= r.body.input.validity.from);
    const packet = entry && app?.state === 'applicable' && body.assessment.state === 'reconciled' && current && !supersededAt
      && command.validAt && within(command.validAt, input.validity) && within(command.validAt, entry.validity) && within(command.validAt, app.validity);
    assertLocalUsp(ctx);
    return UspSelectedDeclarationSchema.parse({ declaration: command.declaration, target: command.target,
      technicalStatus: 'technically_accepted', legalStatus: 'not_assessed', allocationSubject: input.allocationSubject,
      subjectDefinition: input.subjectDefinition, basis: input.basis, basisDefinition: input.basisDefinition,
      jurisdiction: input.jurisdiction, statute: input.statute, denominator: input.denominator, rounding: input.rounding,
      validity: input.validity, supersedes: body.supersedes, assessment: body.assessment, entry,
      applicability: app ? { pin: app.pin, state: app.state, reason: app.reason, evidence: app.evidence,
        purpose: app.purpose, validity: app.validity, consentStatus: app.consentStatus } : null,
      packetState: packet ? 'available' : 'not_assessed' });
  });
}
