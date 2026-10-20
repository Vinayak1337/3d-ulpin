import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import type { ImportPackage, PhysicalFeature } from '@ulpin/contracts';
import { INTAKE_EVIDENCE_LIMITS, INTAKE_EVIDENCE_VERSION, IntakeEvidenceCandidateSchema,
  IntakeEvidenceConfirmSchema, IntakeEvidenceConfirmationSchema, IntakeEvidenceOutcomeSchema,
  IntakeEvidencePageSchema, IntakeKeyProfileInputSchema, IntakeKeyProfileSchema, type DocumentResult,
  type IntakeEvidenceAnchor, type IntakeEvidenceCandidate, type IntakeEvidenceConfirm,
  type IntakeEvidenceCoverage, type IntakeEvidenceKey, type IntakeEvidenceLocator, type IntakeKeyProfileInput,
  type IntakeTableRowLocator } from '@ulpin/contracts/usp';
import { transaction } from '../../../infrastructure/db';
import { AppError, conflict, notFound } from '../../../infrastructure/errors';
import { fingerprint } from '../../cases/domain';
import { registerUspJobInputTx } from '../jobs';
import { appendIntakeItemTx } from './events';
import { intakeCaseTx, intakeSourceTx } from './intake-context';
import { INTAKE_CONFIRMATION_VALIDITY_MS } from './intake-confirmations';
import { stableUuid } from './intake-run';
import type { TabularTable } from './tabular-source';

/**
 * AU4-B2: exact-key evidence of a batch. A table row or a document part is proposed as evidence for a building of
 * the same case only when it holds the key literal exactly as the building's chosen field holds it: no trimming,
 * case or width folding, punctuation stripping or number coercion. Every candidate stays a candidate; nothing here
 * writes the registry, and unread coverage is never absence.
 */
const uuid = z.string().uuid();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const integerLiteral = /^-?(?:0|[1-9][0-9]*)$/;
const wordCharacter = /[\p{L}\p{N}]/u;
const QUOTE_CONTEXT = 80;
type KeyKind = IntakeEvidenceKey['kind'];
type DocumentPart = DocumentResult['native']['parts'][number];
export type EvidenceAssertion = { literal: string; evidence: IntakeEvidenceLocator };
export type ProfileRow = { profile_id: string; case_id: string; request_key: string; input_sha256: string;
  profile_sha256: string; profile: IntakeKeyProfileInput; subject: string; created_at: Date };

export const IntakeEvidenceInputSchema = z.strictObject({
  version: z.literal('intake-evidence-read/1'), jobId: uuid, caseId: uuid, caseRevision: z.number().int().nonnegative(),
  profileId: uuid, profileSha256: hash, itemId: uuid, sourceId: uuid, sourceRevision: z.number().int().positive(),
  sourceSha256: hash, subject: z.string().min(1).max(256), accessSha256: hash,
});
export type IntakeEvidenceInput = z.infer<typeof IntakeEvidenceInputSchema>;

/** Nothing read: what was read is 0 and every other count is unknown, never 0. */
export const NOT_READ: IntakeEvidenceCoverage = { state: 'partial', read: 0, eligible: null, keyless: null,
  unread: null, failed: null };

/** A key as written: a non-blank string, and for an integer key its digits as written. Nothing is changed. */
export function keyLiteral(value: unknown, kind: KeyKind): string | null {
  if (typeof value !== 'string' || !value.trim() || value.length > INTAKE_EVIDENCE_LIMITS.literalChars) return null;
  return kind === 'integer' && !integerLiteral.test(value) ? null : value;
}

/** The property a profile names; a drafted building keeps its source properties, not the source feature id. */
export function keyProperty(sourcePath: string): string | null {
  const match = /^\/features\/\*\/properties\/(.+)$/.exec(sourcePath);
  return match ? match[1].replaceAll('~1', '/').replaceAll('~0', '~') : null;
}

/** The map side of one drafted building, or null when its field holds no key as written (a JSON number has lost
 * its spelling, so it is never read as a key). */
export function evidenceAnchor(target: { targetId: string; anchorItemId: string; packageId: string;
  packageRevision: number; locator: string }, feature: Pick<PhysicalFeature, 'id' | 'properties'>,
source: { id: string; revision: number; sha256: string }, sourcePath: string,
kind: KeyKind): IntakeEvidenceAnchor | null {
  const property = keyProperty(sourcePath);
  const literal = property === null || !Object.hasOwn(feature.properties, property) ? null
    : keyLiteral(feature.properties[property], kind);
  if (literal === null) return null;
  return { targetId: target.targetId, anchorItemId: target.anchorItemId, packageId: target.packageId,
    packageRevision: target.packageRevision, featureId: feature.id, locator: target.locator, sourceId: source.id,
    sourceRevision: source.revision, sourceSha256: source.sha256, sourcePath, literal };
}

/** Each physical row's key cell, with its locator; blank cells and integer keys not written as digits are keyless. */
export function tableAssertions(table: TabularTable, columnIndex: number, kind: KeyKind,
  locate: (index: number, cells: unknown[], literal: string) => IntakeTableRowLocator) {
  if (columnIndex >= table.headers.length) {
    throw new AppError(422, 'INTAKE_EVIDENCE_COLUMN', 'The key column is outside this table\'s header row.');
  }
  const assertions: EvidenceAssertion[] = [];
  for (const [index, row] of table.rows.entries()) {
    const states = table.cellStates?.[index];
    const cells = table.headers.map((_, column) => {
      const state = states?.[column] ?? (row[column] === undefined ? 'absent' : 'literal');
      return state === 'literal' ? { state, value: row[column] } : { state };
    });
    const literal = cells[columnIndex].state === 'literal' ? keyLiteral(row[columnIndex], kind) : null;
    if (literal !== null) assertions.push({ literal, evidence: locate(index, cells, literal) });
  }
  const read = table.rows.length;
  const coverage: IntakeEvidenceCoverage = { state: 'closed', read, eligible: assertions.length,
    keyless: read - assertions.length, unread: 0, failed: 0 };
  return { assertions, coverage };
}

const word = (value: string | undefined) => value !== undefined && wordCharacter.test(value);
/** A literal stands alone where a letter or digit at its edge does not run into another one. */
function bounded(text: string, start: number, literal: string) {
  const end = start + literal.length;
  return (!word(literal[0]) || !word(text[start - 1])) && (!word(literal.at(-1)) || !word(text[end]));
}

/** The first standing occurrence of each building literal in one part. Positions are scanned once per length. */
export function partLiterals(text: string, literals: ReadonlySet<string>): Map<string, number> {
  const lengths = [...new Set([...literals].map(literal => literal.length))];
  const found = new Map<string, number>();
  for (let start = 0; start < text.length; start++) {
    if (start > 0 && word(text[start - 1]) && word(text[start])) continue;
    for (const length of lengths) {
      const candidate = text.slice(start, start + length);
      if (!found.has(candidate) && literals.has(candidate) && bounded(text, start, candidate)) {
        found.set(candidate, start);
      }
    }
  }
  return found;
}

/** Every part that holds a building literal yields one assertion per literal, quoting the exact span around it. */
export function documentAssertions(parts: DocumentPart[], literals: ReadonlySet<string>, complete: boolean,
  locate: (part: DocumentPart, quote: string, start: number) => IntakeEvidenceLocator) {
  const assertions: EvidenceAssertion[] = [];
  let eligible = 0;
  for (const part of parts) {
    const found = partLiterals(part.text, literals);
    if (found.size) eligible++;
    for (const [literal, at] of found) {
      const start = Math.max(0, at - QUOTE_CONTEXT);
      const quote = part.text.slice(start, Math.min(part.text.length, at + literal.length + QUOTE_CONTEXT));
      assertions.push({ literal, evidence: locate(part, quote, start) });
    }
  }
  const read = parts.length;
  const coverage: IntakeEvidenceCoverage = complete
    ? { state: 'closed', read, eligible, keyless: read - eligible, unread: 0, failed: 0 }
    : { state: 'partial', read, eligible, keyless: read - eligible, unread: null, failed: null };
  return { assertions, coverage };
}

function evidenceIdentity(evidence: IntakeEvidenceLocator) {
  return evidence.kind === 'table_row'
    ? `${evidence.itemId}:${evidence.sourceRevision}:${evidence.sourceSha256}:${evidence.sourceRow}:`
      + `${evidence.columnIndex}`
    : `${evidence.itemId}:${evidence.sourceRevision}:${evidence.partId}:${evidence.quoteStart}`;
}

/**
 * The candidates of one source under one profile. Only the source and the buildings decide an outcome, so the
 * same sources read in any order give the same candidates. Precedence: conflicting (the same key on more than one
 * row of one table, with a building) > several (more than one building) > matched > no_match.
 */
export function closeEvidence(input: { caseId: string; key: Omit<IntakeEvidenceKey, 'literal'>;
  assertions: EvidenceAssertion[]; anchors: IntakeEvidenceAnchor[]; coverage: IntakeEvidenceCoverage;
  createdAt: string }): IntakeEvidenceCandidate[] {
  const buildings = new Map<string, IntakeEvidenceAnchor[]>();
  for (const anchor of [...input.anchors].sort((a, b) => a.targetId.localeCompare(b.targetId))) {
    buildings.set(anchor.literal, [...(buildings.get(anchor.literal) ?? []), anchor]);
  }
  const rows = new Map<string, number>();
  for (const { literal, evidence } of input.assertions) {
    if (evidence.kind === 'table_row') rows.set(literal, (rows.get(literal) ?? 0) + 1);
  }
  return input.assertions.map(({ literal, evidence }) => {
    // The stored shape names at most 16 buildings; more than one is several either way.
    const anchors = (buildings.get(literal) ?? []).slice(0, INTAKE_EVIDENCE_LIMITS.targets);
    const repeated = (rows.get(literal) ?? 0) > 1 && evidence.kind === 'table_row';
    const outcome = anchors.length && repeated ? 'conflicting'
      : anchors.length > 1 ? 'several' : anchors.length ? 'matched' : 'no_match';
    const body = { version: INTAKE_EVIDENCE_VERSION, caseId: input.caseId, key: { ...input.key, literal }, evidence,
      outcome, anchors, sourceCoverage: input.coverage, state: 'candidate', qualification: 'not_assessed',
      conflictGroup: outcome === 'conflicting'
        ? stableUuid(`intake-evidence/1:conflict:${input.key.profileId}:${evidence.itemId}:${literal}`) : null };
    return IntakeEvidenceCandidateSchema.parse({ ...body, createdAt: input.createdAt,
      candidateId: stableUuid(`intake-evidence/1:${input.key.profileId}:${evidenceIdentity(evidence)}:${literal}`),
      candidateSha256: fingerprint(body) });
  });
}

function profileView(row: ProfileRow) {
  return IntakeKeyProfileSchema.parse({ profileId: row.profile_id, caseId: row.case_id,
    profileSha256: row.profile_sha256, input: row.profile, subject: row.subject,
    createdAt: new Date(row.created_at).toISOString() });
}

/** The profile hash pins what is read and how; the request key only names the request. */
export function keyProfileSha256(input: IntakeKeyProfileInput) {
  const { requestKey: _requestKey, ...profile } = input;
  return fingerprint(profile);
}

/** A layer taken out of a ZIP keeps no source of its own; only a table or document read here must have one. */
async function itemTx(client: PoolClient, caseId: string, itemId: string, family: string, retained = true) {
  const item = (await client.query(`SELECT item_id,family,format,source_id FROM usp_intake_items
    WHERE case_id=$1 AND item_id=$2`, [caseId, itemId])).rows[0] ?? notFound('Intake item not found in this case.');
  if (item.family !== family || retained && !item.source_id) {
    throw new AppError(422, 'INTAKE_EVIDENCE_ITEM', `Item ${itemId} is not a retained ${family} of this batch.`);
  }
  if (retained) await intakeSourceTx(client, caseId, item.source_id);
  return item;
}

async function assertProfileItemsTx(client: PoolClient, caseId: string, input: IntakeKeyProfileInput) {
  await itemTx(client, caseId, input.map.anchorItemId, 'vector', false);
  // A drafted building keeps only its mapped fields; a key no building keeps would make every row look unmatched.
  if (!(await evidenceAnchorsTx(client, caseId, input)).length) throw new AppError(409,
    'INTAKE_EVIDENCE_ANCHOR_NOT_DRAFTED', 'No drafted building of the map item holds this field as written yet; '
      + 'declare the key once its buildings are drafted with the field mapped.');
  for (const table of input.tables) {
    const item = await itemTx(client, caseId, table.itemId, 'table');
    if (item.format !== table.selection.format) throw new AppError(422, 'INTAKE_EVIDENCE_ITEM',
      `Item ${table.itemId} is not a ${table.selection.format} table.`);
  }
  for (const itemId of input.documents) await itemTx(client, caseId, itemId, 'document');
}

/** One read of one source under one profile, enrolled once in the existing job authority. */
export async function queueIntakeEvidenceTx(client: PoolClient, caseId: string,
  profile: Pick<ProfileRow, 'profile_id' | 'profile_sha256'>, itemId: string): Promise<string | null> {
  const item = (await client.query(`SELECT family,source_id FROM usp_intake_items WHERE case_id=$1 AND item_id=$2`,
    [caseId, itemId])).rows[0];
  if (!item?.source_id || !['table', 'document'].includes(item.family)) return null;
  const { current, binding, source } = await intakeSourceTx(client, caseId, item.source_id);
  const jobId = stableUuid(`intake-evidence/1:${profile.profile_id}:${profile.profile_sha256}:${itemId}:`
    + `${source.id}:${source.revision}:${source.sha256}`);
  if ((await client.query('SELECT id FROM jobs WHERE id=$1', [jobId])).rowCount) return jobId;
  const input = IntakeEvidenceInputSchema.parse({ version: 'intake-evidence-read/1', jobId, caseId,
    caseRevision: current.revision, profileId: profile.profile_id, profileSha256: profile.profile_sha256, itemId,
    sourceId: source.id, sourceRevision: source.revision, sourceSha256: source.sha256, subject: binding.subject,
    accessSha256: binding.access });
  const digest = fingerprint(input);
  await client.query(`INSERT INTO jobs(id,case_id,source_id,operation,case_revision,input_fingerprint,payload)
    VALUES($1,$2,$3,'intake-evidence',$4,$5,$6)`, [jobId, caseId, source.id, current.revision, digest, input]);
  await registerUspJobInputTx(client, jobId,
    { kind: 'intake', workspaceId: caseId, version: current.revision + 1 }, source.id, digest);
  // The reading names its job, so only that job may close or stop it.
  await client.query(`INSERT INTO usp_intake_evidence_coverage(profile_id,item_id,case_id,family,state,job_id)
    VALUES($1,$2,$3,$4,'reading',$5) ON CONFLICT(profile_id,item_id) DO UPDATE SET state='reading',job_id=$5,
    result_sha256=NULL,read_count=NULL,eligible_count=NULL,keyless_count=NULL,unread_count=NULL,failed_count=NULL,
    updated_at=now()`, [profile.profile_id, itemId, caseId, item.family, jobId]);
  await appendIntakeItemTx(client, caseId, itemId);
  return jobId;
}

/** D4: a table or document kept after a profile exists is read under every profile of its case. */
export async function queueLateIntakeEvidenceTx(client: PoolClient, caseId: string, itemId: string, family: string) {
  if (!['table', 'document'].includes(family)) return;
  const profiles = (await client.query(`SELECT profile_id,profile_sha256 FROM usp_intake_key_profiles
    WHERE case_id=$1 ORDER BY created_at,profile_id LIMIT $2`, [caseId, INTAKE_EVIDENCE_LIMITS.sources])).rows;
  for (const profile of profiles) await queueIntakeEvidenceTx(client, caseId, profile, itemId);
}

/** The officer names the key; every named source is queued for reading in the same transaction. */
export async function declareIntakeKeyProfile(caseValue: string, raw: unknown) {
  const caseId = uuid.parse(caseValue);
  const input = IntakeKeyProfileInputSchema.parse(raw);
  if (keyProperty(input.map.sourcePath) === null) throw new AppError(422, 'INTAKE_EVIDENCE_KEY_PATH',
    'Name a property of the map features; a drafted building does not keep the source feature id.');
  return transaction(async client => {
    const { binding } = await intakeCaseTx(client, caseId, true);
    const digest = fingerprint(input);
    const prior: ProfileRow | undefined = (await client.query(`SELECT * FROM usp_intake_key_profiles
      WHERE case_id=$1 AND request_key=$2`, [caseId, input.requestKey])).rows[0];
    if (prior) {
      if (prior.input_sha256 !== digest) conflict('This key profile request key names a different profile.');
      return profileView(prior);
    }
    await assertProfileItemsTx(client, caseId, input);
    const row: ProfileRow = (await client.query(`INSERT INTO usp_intake_key_profiles(profile_id,case_id,request_key,
      input_sha256,profile_sha256,version,namespace,key_kind,anchor_item_id,source_path,profile,subject)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [randomUUID(), caseId, input.requestKey, digest, keyProfileSha256(input), input.version, input.namespace,
      input.kind, input.map.anchorItemId, input.map.sourcePath, input, binding.subject])).rows[0];
    for (const itemId of [...input.tables.map(table => table.itemId), ...input.documents]) {
      await queueIntakeEvidenceTx(client, caseId, row, itemId);
    }
    return profileView(row);
  });
}

/** The reading's pins hold: the profile, the item's retained source and the private access it was queued under. */
export async function assertIntakeEvidenceInputTx(client: PoolClient, input: IntakeEvidenceInput) {
  const { source, binding } = await intakeSourceTx(client, input.caseId, input.sourceId);
  const profile: ProfileRow | undefined = (await client.query(`SELECT * FROM usp_intake_key_profiles
    WHERE case_id=$1 AND profile_id=$2`, [input.caseId, input.profileId])).rows[0];
  const item = (await client.query('SELECT source_id FROM usp_intake_items WHERE case_id=$1 AND item_id=$2',
    [input.caseId, input.itemId])).rows[0];
  if (profile?.profile_sha256 !== input.profileSha256 || item?.source_id !== input.sourceId
    || source.revision !== input.sourceRevision || source.sha256 !== input.sourceSha256
    || binding.subject !== input.subject || binding.access !== input.accessSha256) {
    conflict('This evidence reading no longer matches its key profile or retained source.');
  }
  return { profile: profile!, source };
}

/** The map side of a profile: every drafted building of its anchor item whose field holds a key as written. */
export async function evidenceAnchorsTx(client: PoolClient, caseId: string, profile: IntakeKeyProfileInput) {
  const targets = (await client.query(`SELECT target_id,anchor_item_id,package_id,feature_id,locator
    FROM usp_intake_targets WHERE case_id=$1 AND anchor_item_id=$2 ORDER BY target_id`,
  [caseId, profile.map.anchorItemId])).rows;
  const packages = new Map((await client.query('SELECT id,body FROM import_packages WHERE id=ANY($1::uuid[])',
    [[...new Set(targets.map(row => row.package_id))]])).rows.map(row => [row.id, row.body as ImportPackage]));
  const features = new Map([...packages.values()].flatMap(pkg => pkg.features.map(f => [f.id, f] as const)));
  const sources = new Map((await client.query('SELECT id,revision,sha256 FROM sources WHERE case_id=$1 AND id=ANY($2)',
    [caseId, [...new Set([...features.values()].map(f => f.sourceRevisionId))]])).rows.map(row => [row.id, row]));
  return targets.flatMap(row => {
    const feature = features.get(row.feature_id), pkg = packages.get(row.package_id);
    const source = feature && sources.get(feature.sourceRevisionId);
    const anchor = feature && pkg && source && evidenceAnchor({ targetId: row.target_id,
      anchorItemId: row.anchor_item_id, packageId: row.package_id, packageRevision: pkg.revision,
      locator: row.locator }, feature, source, profile.map.sourcePath, profile.kind);
    return anchor ? [anchor] : [];
  });
}

/** Only the job a reading names may write it; a later queued reading has replaced an earlier one. */
async function ownCoverageTx(client: PoolClient, input: IntakeEvidenceInput) {
  const row = (await client.query(`SELECT job_id FROM usp_intake_evidence_coverage WHERE profile_id=$1 AND item_id=$2
    FOR UPDATE`, [input.profileId, input.itemId])).rows[0];
  if (row?.job_id !== input.jobId) conflict('A later reading of this source under this profile replaced this one.');
}

async function setCoverageTx(client: PoolClient, input: IntakeEvidenceInput, coverage: IntakeEvidenceCoverage,
  resultSha256: string | null) {
  await client.query(`UPDATE usp_intake_evidence_coverage SET state=$3,result_sha256=$4,read_count=$5,
    eligible_count=$6,keyless_count=$7,unread_count=$8,failed_count=$9,updated_at=now()
    WHERE profile_id=$1 AND item_id=$2`, [input.profileId, input.itemId, coverage.state, resultSha256, coverage.read,
    coverage.eligible, coverage.keyless, coverage.unread, coverage.failed]);
  await appendIntakeItemTx(client, input.caseId, input.itemId);
}

/** One reading's coverage and candidates replace that source's earlier candidates under the profile, together. */
export async function writeIntakeEvidenceTx(client: PoolClient, input: IntakeEvidenceInput,
  coverage: IntakeEvidenceCoverage, resultSha256: string, candidates: IntakeEvidenceCandidate[]) {
  await ownCoverageTx(client, input);
  const ids = candidates.map(candidate => candidate.candidateId);
  await client.query(`DELETE FROM usp_intake_evidence_candidates WHERE profile_id=$1 AND item_id=$2
    AND NOT (candidate_id=ANY($3::uuid[]))`, [input.profileId, input.itemId, ids]);
  const rows = candidates.map(candidate => ({ candidate,
    operationKey: stableUuid(`intake-evidence/1:${candidate.candidateId}:${candidate.candidateSha256}`) }));
  await client.query(`INSERT INTO usp_intake_evidence_candidates(candidate_id,case_id,profile_id,item_id,
    operation_key,evidence_kind,key_literal,outcome,target_ids,conflict_group,candidate,candidate_sha256)
    SELECT (r->'candidate'->>'candidateId')::uuid,$1,$2,$3,(r->>'operationKey')::uuid,
      r->'candidate'->'evidence'->>'kind',r->'candidate'->'key'->>'literal',r->'candidate'->>'outcome',
      ARRAY(SELECT (a->>'targetId')::uuid FROM jsonb_array_elements(r->'candidate'->'anchors') a),
      (r->'candidate'->>'conflictGroup')::uuid,r->'candidate',r->'candidate'->>'candidateSha256'
    FROM jsonb_array_elements($4::jsonb) r
    ON CONFLICT(candidate_id) DO UPDATE SET operation_key=EXCLUDED.operation_key,outcome=EXCLUDED.outcome,
      target_ids=EXCLUDED.target_ids,conflict_group=EXCLUDED.conflict_group,candidate=EXCLUDED.candidate,
      candidate_sha256=EXCLUDED.candidate_sha256`, [input.caseId, input.profileId, input.itemId,
    JSON.stringify(rows)]);
  await setCoverageTx(client, input, coverage, resultSha256);
}

/** A reading that stopped leaves its source unread (read 0, every other count unknown) and proposes nothing. */
export async function stopIntakeEvidenceTx(client: PoolClient, input: IntakeEvidenceInput) {
  await ownCoverageTx(client, input);
  await client.query('DELETE FROM usp_intake_evidence_candidates WHERE profile_id=$1 AND item_id=$2',
    [input.profileId, input.itemId]);
  await setCoverageTx(client, input, NOT_READ, null);
}

type CoverageRow = { profile_id: string; item_id: string; family: 'table' | 'document'; job_id: string | null;
  result_sha256: string | null; state: IntakeEvidenceCoverage['state']; read_count: string | null;
  eligible_count: string | null; keyless_count: string | null; unread_count: string | null;
  failed_count: string | null };
const counted = (value: string | null) => value === null ? null : Number(value);
export function coverageOf(row: CoverageRow): IntakeEvidenceCoverage {
  return { state: row.state, read: counted(row.read_count), eligible: counted(row.eligible_count),
    keyless: counted(row.keyless_count), unread: counted(row.unread_count), failed: counted(row.failed_count) };
}

type ConfirmationRow = { confirmation_id: string; case_id: string; input_sha256: string; profile_id: string;
  additions: 'citations' | 'no_additions'; pins: IntakeEvidenceConfirm; subject: string; expires_at: Date;
  created_at: Date };
export const EVIDENCE_CONFIRMATION_NOTE = 'Stored with every pin it names. Nothing was written to the registry: '
  + 'the citation step adds accepted rows and parts to recorded buildings under this confirmation.';

function confirmationView(row: ConfirmationRow) {
  return IntakeEvidenceConfirmationSchema.parse({ confirmationId: row.confirmation_id, caseId: row.case_id,
    inputSha256: row.input_sha256, input: row.pins, subject: row.subject,
    expiresAt: new Date(row.expires_at).toISOString(), createdAt: new Date(row.created_at).toISOString(),
    registryWritten: false, note: EVIDENCE_CONFIRMATION_NOTE });
}

/** Sources read under a profile that a stored confirmation names neither way: they arrived or were read after it. */
export function newerSources(pins: IntakeEvidenceConfirm, read: string[]) {
  const named = new Set([...pins.included, ...pins.excluded].map(source => source.itemId));
  return read.filter(itemId => !named.has(itemId));
}

/** Profiles, coverage and stored confirmations of the case, and one page of candidates with counts by outcome. */
export async function readIntakeEvidence(caseValue: string, query: { outcome?: string; cursor?: string }) {
  const caseId = uuid.parse(caseValue);
  const outcome = query.outcome === undefined ? null : IntakeEvidenceOutcomeSchema.parse(query.outcome);
  const cursor = query.cursor === undefined ? null : uuid.parse(query.cursor);
  const limit = INTAKE_EVIDENCE_LIMITS.sources;
  return transaction(async client => {
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    await intakeCaseTx(client, caseId);
    const profiles: ProfileRow[] = (await client.query(`SELECT * FROM usp_intake_key_profiles WHERE case_id=$1
      ORDER BY created_at,profile_id LIMIT $2`, [caseId, limit])).rows;
    const sources: CoverageRow[] = (await client.query(`SELECT * FROM usp_intake_evidence_coverage WHERE case_id=$1
      ORDER BY profile_id,item_id LIMIT $2`, [caseId, limit])).rows;
    const confirmations: ConfirmationRow[] = (await client.query(`SELECT * FROM usp_intake_evidence_confirmations
      WHERE case_id=$1 ORDER BY created_at,confirmation_id LIMIT $2`, [caseId, limit])).rows;
    const rows = (await client.query(`SELECT candidate FROM usp_intake_evidence_candidates WHERE case_id=$1
      AND ($2::text IS NULL OR outcome=$2) AND ($3::uuid IS NULL OR candidate_id>$3) ORDER BY candidate_id LIMIT $4`,
    [caseId, outcome, cursor, INTAKE_EVIDENCE_LIMITS.page + 1])).rows;
    const tallies = (await client.query(`SELECT outcome,count(*)::int n FROM usp_intake_evidence_candidates
      WHERE case_id=$1 GROUP BY outcome`, [caseId])).rows;
    const page = rows.slice(0, INTAKE_EVIDENCE_LIMITS.page).map(row => row.candidate as IntakeEvidenceCandidate);
    const counts = Object.fromEntries(IntakeEvidenceOutcomeSchema.options.map(name =>
      [name, Number(tallies.find(row => row.outcome === name)?.n ?? 0)]));
    return IntakeEvidencePageSchema.parse({ caseId, profiles: profiles.map(profileView),
      confirmations: confirmations.map(row => ({ confirmationId: row.confirmation_id, profileId: row.profile_id,
        additions: row.additions, createdAt: new Date(row.created_at).toISOString(),
        expiresAt: new Date(row.expires_at).toISOString(), newerSources: newerSources(row.pins,
          sources.filter(source => source.profile_id === row.profile_id).map(source => source.item_id)) })),
      sources: sources.map(row => ({ itemId: row.item_id, profileId: row.profile_id, family: row.family,
        jobId: row.job_id, resultSha256: row.result_sha256, coverage: coverageOf(row) })),
      candidates: page, counts, nextCursor: rows.length > page.length ? page.at(-1)!.candidateId : null });
  });
}

/** What a confirmation is checked against, read in the confirming transaction. */
export type EvidenceState = {
  profileSha256: string | null;
  sources: Map<string, { sourceId: string; sourceRevision: number; sourceSha256: string; bytes: number;
    latest: boolean }>;
  coverage: Map<string, { jobId: string | null; resultSha256: string | null; coverage: IntakeEvidenceCoverage }>;
  targets: Map<string, { packageId: string; packageRevision: number; reviewFingerprint: string | null }>;
  candidates: Map<string, { itemId: string; candidateSha256: string; targetIds: string[];
    evidence: IntakeEvidenceLocator }>;
};

/** The officer's link manifest: the decisions as sent, in candidate order. */
export function evidenceLinkManifest(decisions: { candidateId: string }[]) {
  return fingerprint([...decisions].sort((a, b) => a.candidateId.localeCompare(b.candidateId)));
}

type NamedSource = Pick<IntakeEvidenceConfirm['excluded'][number], 'itemId' | 'sourceId' | 'sourceRevision'
  | 'sourceSha256' | 'bytes'>;
function sourceIssue(named: NamedSource, state: EvidenceState) {
  const current = state.sources.get(named.itemId);
  if (!current) return `Source item ${named.itemId} is not a retained source of this case.`;
  if (!current.latest || current.sourceId !== named.sourceId || current.sourceRevision !== named.sourceRevision
    || current.sourceSha256 !== named.sourceSha256 || current.bytes !== named.bytes) {
    return `Source item ${named.itemId} is not at the source pins named.`;
  }
  return null;
}

type Decision = Extract<IntakeEvidenceConfirm['additions'], { kind: 'citations' }>['decisions'][number];
function decisionIssue(decision: Decision, state: EvidenceState, included: Set<string>) {
  const current = state.candidates.get(decision.candidateId);
  if (!current || current.candidateSha256 !== decision.candidateSha256) {
    return `Candidate ${decision.candidateId} is not at the pins named under this profile.`;
  }
  if (!included.has(current.itemId)) return `Candidate ${decision.candidateId} comes from a source not included.`;
  if (decision.decision === 'reject') return null;
  if (!current.targetIds.includes(decision.targetId)) {
    return `Candidate ${decision.candidateId} does not name building ${decision.targetId}.`;
  }
  return fingerprint(current.evidence) === fingerprint(decision.evidence) ? null
    : `Candidate ${decision.candidateId} cites another row or part.`;
}

/** The first pin that no longer holds, or null. A stale pin refuses the whole confirmation. */
export function evidenceConfirmationIssue(input: IntakeEvidenceConfirm, state: EvidenceState): string | null {
  if (state.profileSha256 !== input.profileSha256) return 'The key profile is not at the pins named.';
  for (const named of [...input.included, ...input.excluded]) {
    const issue = sourceIssue(named, state);
    if (issue) return issue;
  }
  for (const named of input.included) {
    const read = state.coverage.get(named.itemId);
    if (!read || read.jobId !== named.jobId || read.resultSha256 !== named.resultSha256
      || fingerprint(read.coverage) !== fingerprint(named.coverage)) {
      return `Source item ${named.itemId} has another reading under this profile.`;
    }
  }
  const named = new Set([...input.included, ...input.excluded].map(source => source.itemId));
  const unnamed = [...state.coverage.keys()].find(itemId => !named.has(itemId));
  if (unnamed) return `Source item ${unnamed} was read under this profile; include or exclude it.`;
  for (const target of input.targets) {
    const current = state.targets.get(target.targetId);
    if (!current || current.packageId !== target.packageId || current.packageRevision !== target.packageRevision
      || current.reviewFingerprint !== target.reviewFingerprint) {
      return `Building ${target.targetId} is not at the package pins named.`;
    }
  }
  if (input.additions.kind === 'no_additions') return null;
  if (evidenceLinkManifest(input.additions.decisions) !== input.additions.linkManifestSha256) {
    return 'The link manifest hash does not match the decisions sent.';
  }
  const included = new Set(input.included.map(source => source.itemId));
  for (const decision of input.additions.decisions) {
    const issue = decisionIssue(decision, state, included);
    if (issue) return issue;
  }
  return null;
}

async function evidenceStateTx(client: PoolClient, caseId: string, input: IntakeEvidenceConfirm) {
  const profile = (await client.query(`SELECT profile_sha256 FROM usp_intake_key_profiles
    WHERE case_id=$1 AND profile_id=$2 FOR SHARE`, [caseId, input.profileId])).rows[0];
  const items = [...input.included, ...input.excluded].map(source => source.itemId);
  const sources = (await client.query(`SELECT i.item_id,s.id,s.revision,s.sha256,s.bytes,
    s.revision=(SELECT max(x.revision) FROM sources x WHERE x.case_id=s.case_id AND x.family_id=s.family_id) latest
    FROM usp_intake_items i JOIN sources s ON s.id=i.source_id WHERE i.case_id=$1 AND i.item_id=ANY($2::uuid[])`,
  [caseId, items])).rows;
  const coverage: CoverageRow[] = (await client.query(`SELECT * FROM usp_intake_evidence_coverage
    WHERE case_id=$1 AND profile_id=$2`, [caseId, input.profileId])).rows;
  const targets = (await client.query(`SELECT t.target_id,t.package_id,(p.body->>'revision')::int revision,
    CASE WHEN p.body->'review'->'packageRevision'=p.body->'revision' THEN p.body->'review'->>'inputFingerprint'
    END review FROM usp_intake_targets t JOIN import_packages p ON p.id=t.package_id
    WHERE t.case_id=$1 AND t.target_id=ANY($2::uuid[])`, [caseId, input.targets.map(t => t.targetId)])).rows;
  const decisions = input.additions.kind === 'citations' ? input.additions.decisions : [];
  const candidates = (await client.query(`SELECT candidate_id,item_id,candidate_sha256,target_ids,
    candidate->'evidence' evidence FROM usp_intake_evidence_candidates WHERE case_id=$1 AND profile_id=$2
    AND candidate_id=ANY($3::uuid[])`, [caseId, input.profileId, decisions.map(d => d.candidateId)])).rows;
  return { profileSha256: profile?.profile_sha256 ?? null,
    sources: new Map(sources.map(row => [row.item_id, { sourceId: row.id, sourceRevision: row.revision,
      sourceSha256: row.sha256, bytes: Number(row.bytes), latest: row.latest }])),
    coverage: new Map(coverage.map(row => [row.item_id, { jobId: row.job_id, resultSha256: row.result_sha256,
      coverage: coverageOf(row) }])),
    targets: new Map(targets.map(row => [row.target_id, { packageId: row.package_id, packageRevision: row.revision,
      reviewFingerprint: row.review ?? null }])),
    candidates: new Map(candidates.map(row => [row.candidate_id, { itemId: row.item_id,
      candidateSha256: row.candidate_sha256, targetIds: row.target_ids, evidence: row.evidence }])),
  } satisfies EvidenceState;
}

/** D2: the officer's evidence confirmation is stored with all its pins; a stale pin refuses it. No registry write. */
export async function confirmIntakeEvidence(caseValue: string, raw: unknown) {
  const caseId = uuid.parse(caseValue);
  const input = IntakeEvidenceConfirmSchema.parse(raw);
  return transaction(async client => {
    const { binding } = await intakeCaseTx(client, caseId, true);
    const digest = fingerprint(input);
    const prior: ConfirmationRow | undefined = (await client.query(`SELECT * FROM usp_intake_evidence_confirmations
      WHERE case_id=$1 AND request_key=$2`, [caseId, input.requestKey])).rows[0];
    if (prior) {
      if (prior.input_sha256 !== digest) conflict('This evidence confirmation request key names other pins.');
      return confirmationView(prior);
    }
    const issue = evidenceConfirmationIssue(input, await evidenceStateTx(client, caseId, input));
    if (issue) throw new AppError(409, 'INTAKE_EVIDENCE_STALE', issue);
    const createdAt = new Date();
    const row: ConfirmationRow = (await client.query(`INSERT INTO usp_intake_evidence_confirmations(confirmation_id,
      case_id,request_key,input_sha256,profile_id,profile_sha256,additions,link_manifest_sha256,pins,subject,
      acknowledgement,expires_at,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [randomUUID(), caseId, input.requestKey, digest, input.profileId, input.profileSha256, input.additions.kind,
      input.additions.kind === 'citations' ? input.additions.linkManifestSha256 : null, input, binding.subject,
      input.acknowledgement, new Date(createdAt.getTime() + INTAKE_CONFIRMATION_VALIDITY_MS), createdAt])).rows[0];
    for (const source of input.included) await appendIntakeItemTx(client, caseId, source.itemId);
    return confirmationView(row);
  });
}
