import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type { PoolClient } from 'pg';
import { TabularMappingReceiptSchema, TabularSourceProfileSchema,
  type TabularMappingReceipt, type TabularSourceProfile } from '@ulpin/contracts/usp';
import { settings } from '../../../infrastructure/config';
import { query } from '../../../infrastructure/db';
import { AppError, conflict } from '../../../infrastructure/errors';
import { readObject, sha256 } from '../../../infrastructure/storage';
import { fingerprint } from '../../cases/domain';
import { assertTeacherOutputOutsideGit } from '../../model-gateway/recordings';
import { localOperatorSubject } from '../principal';
import { rememberMapping } from './mapping-memory';
import { columnProfileHash, mappingContextFromColumnProfile } from './mapping-teacher';
import { officerMappingMethod, validateTabularRecipe } from './tabular-recipe';
import { assertTabularPin } from './tabular-source';

export function tabularLearningPaths() {
  const root = process.env.ULPIN_TABULAR_LEARNING_DIR ?? 'E:/BhuAayam-data/task-data/a3b/learning';
  const seed = process.env.ULPIN_TABULAR_LEARNER_SEED ?? 'E:/BhuAayam-data/task-data/a4/learner/v43';
  for (const path of [root, seed]) {
    if (/(?:^|[\\/])(?:demo\.env|\.env(?:\.|$))/i.test(path)) throw new Error('TABULAR_LEARNING_PATH_DENIED');
    assertTeacherOutputOutsideGit(path);
  }
  return { root, seed, memory: join(root, 'accepted-plans.jsonl') };
}

export async function activeTabularLearner(client: PoolClient): Promise<string> {
  const row = (await client.query("SELECT result FROM operations WHERE kind='manual-mapping' " +
    "AND operation_key LIKE 'manual-learn:%' AND result->>'version' ~ '^v[1-9][0-9]*$' " +
    "ORDER BY length(result->>'version') DESC,result->>'version' DESC LIMIT 1")).rows[0];
  const model = row?.result.model ?? tabularLearningPaths().seed;
  const paths = tabularLearningPaths();
  const withinRoot = relative(resolve(paths.root), resolve(model));
  if (resolve(model) !== resolve(paths.seed) && (isAbsolute(withinRoot) || withinRoot.startsWith('..'))) {
    throw new AppError(503, 'TABULAR_LEARNER_PATH', 'The active learner lies outside its configured artifact root.');
  }
  return model;
}

function immutableText(path: string, text: string) {
  if (existsSync(path)) {
    if (readFileSync(path, 'utf8') !== text) throw new Error('TABULAR_LEARNING_ARTIFACT_CHANGED');
  } else writeFileSync(path, text, { flag: 'wx', mode: 0o600 });
}

function officerExamples(receipt: TabularMappingReceipt, profile: TabularSourceProfile, source: any) {
  const { dry, table } = validateTabularRecipe(receipt.plan, profile, source.bytes);
  const profileHash = columnProfileHash(profile.profile);
  const examples = receipt.plan.mapping.fields.map(field => ({ layoutFingerprint: profile.profile.layoutFingerprint,
    columnProfile: profile.profile.columns.find(column => column.name === field.sourceField), target: field.target,
    operation: field.operation, method: receipt.plan.mapping.method, verified: true, labelKind: 'officer', profileHash,
    officerDecisionId: `${receipt.id}:${receipt.revision}`, dryRun: { cells: table.rows.length,
      needsInput: dry.rows.filter(row => row.fields.some(cell => cell.sourceField === field.sourceField &&
        cell.state === 'needs_input')).length, conflicting: dry.rows.filter(row => row.fields.some(cell =>
        cell.sourceField === field.sourceField && cell.state === 'conflicting')).length } }));
  const links = profile.profile.columns.map((column, index) => ({ ...column, header: profile.headers[index],
    profileId: fingerprint([profileHash, column.name]), profileHash, sourceField: column.name,
    family: profile.tabular.developmentFamily, split: 'dev', cellCount: Math.min(100, table.rows.length),
    emptyCount: table.rows.slice(0, 100).filter(row => row[index] === undefined || row[index] === null ||
      typeof row[index] === 'string' && !(row[index] as string).trim()).length,
    neighbourHeaders: profile.headers.slice(Math.max(0, index - 2), index)
      .concat(profile.headers.slice(index + 1, index + 3)) }));
  return { examples, links };
}

type LearnerResult = { model: string; version: string };

function completedLearner(out: string, examples: string, resume: string): LearnerResult | null {
  const path = join(out, 'completed.json');
  if (!existsSync(path)) return null;
  const result = JSON.parse(readFileSync(path, 'utf8')) as LearnerResult;
  if (!/^v[1-9]\d*$/.test(result.version) || resolve(result.model) !== resolve(out, result.version)) {
    throw new AppError(503, 'TABULAR_LEARNER_OUTPUT', 'The retained model receipt has invalid path or version pins.');
  }
  const manifest = JSON.parse(readFileSync(join(result.model, 'manifest.json'), 'utf8'));
  if (manifest.approvedBatchSha256 !== sha256(readFileSync(examples)) ||
      manifest.modelSha256 !== sha256(readFileSync(join(result.model, 'model.npz')))) {
    throw new AppError(503, 'TABULAR_LEARNER_INTEGRITY', 'The retained approved model or example hash changed.');
  }
  const parent = JSON.parse(readFileSync(join(resume, 'manifest.json'), 'utf8'));
  if (manifest.parentModelSha256 !== parent.modelSha256) {
    throw new AppError(409, 'TABULAR_LEARNER_PARENT_CHANGED', 'A newer model superseded this unpublished checkpoint.');
  }
  return result;
}

function trainOfficerBatch(examples: string, resume: string): LearnerResult {
  const out = join(dirname(examples), 'learner');
  const prior = completedLearner(out, examples, resume);
  if (prior) return prior;
  if (existsSync(out)) {
    throw new AppError(503, 'TABULAR_LEARNER_CHECKPOINT', 'An incomplete learner checkpoint needs owner recovery.');
  }
  const run = spawnSync(process.env.ULPIN_PROFILE_PYTHON ?? 'python', [
    '-m', 'geo.usp_learning.stage_a', 'online', '--examples', examples, '--out', out, '--resume', resume,
  ], { encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024, env: { ...process.env,
    PYTHONPATH: join(settings.repositoryRoot, 'services/geo'), PYTHONDONTWRITEBYTECODE: '1' } });
  if (run.status !== 0) {
    throw new AppError(503, 'TABULAR_LEARNER_UNAVAILABLE', 'The approved batch remains replayable.');
  }
  const result = JSON.parse(run.stdout);
  if (!/^v[1-9]\d*$/.test(result.version) || resolve(result.model) !== resolve(out, result.version)) {
    throw new AppError(503, 'TABULAR_LEARNER_OUTPUT', 'The learner returned an unpinned model path or version.');
  }
  immutableText(join(out, 'completed.json'), JSON.stringify(result) + '\n');
  return completedLearner(out, examples, resume)!;
}

function persistOfficerBatch(receipt: TabularMappingReceipt, profile: TabularSourceProfile, bytes: Uint8Array) {
  const batch = officerExamples(receipt, profile, { bytes });
  const directory = join(tabularLearningPaths().root, 'approvals', `${receipt.id}-${receipt.revision}`);
  mkdirSync(directory, { recursive: true });
  const examples = join(directory, 'examples.jsonl');
  immutableText(examples, batch.examples.map(row => JSON.stringify(row)).join('\n') + '\n');
  immutableText(join(directory, 'profile-links.jsonl'), batch.links.map(row => JSON.stringify(row)).join('\n') + '\n');
  rememberMapping(receipt.plan.mapping, mappingContextFromColumnProfile(profile.profile, profile.tabular.selection), {
    source: 'officer', method: receipt.plan.mapping.method, officerDecisionId: `${receipt.id}:${receipt.revision}`,
  }, tabularLearningPaths().memory);
  return examples;
}

async function assertRecordedApprovalTx(client: PoolClient, value: unknown) {
  const receipt = TabularMappingReceiptSchema.parse(value);
  if (receipt.state !== 'approved' || receipt.approval?.subject !== localOperatorSubject() ||
      receipt.approval.provenance !== 'server_configured_local_operator' ||
      receipt.approval.planHash !== receipt.planHash ||
      receipt.planHash !== fingerprint({ plan: receipt.plan, destination: null }) ||
      receipt.plan.mapping.method !== officerMappingMethod(receipt.approval.subject)) {
    throw new AppError(409, 'TABULAR_APPROVAL_REQUIRED', 'Unapproved proposals never reach memory or training.');
  }
  const recorded = (await client.query('SELECT body FROM usp_mapping_recipes WHERE id=$1 AND case_id=$2 FOR SHARE',
    [receipt.id, receipt.plan.caseId])).rows[0]?.body;
  if (fingerprint(recorded) !== fingerprint(receipt)) conflict('The server-recorded approval changed.');
  return receipt;
}

/** The existing fenced chunk job is the background learner; a transaction lock serializes all CPU updates. */
export async function learnApprovedTabularTx(client: PoolClient, value: unknown, profile: unknown, source: any) {
  const receipt = await assertRecordedApprovalTx(client, value);
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('tabular-officer-learner-v1',0))");
  const key = `manual-learn:${receipt.id}:${receipt.revision}`;
  const prior = (await client.query("SELECT result FROM operations WHERE case_id=$1 AND operation_key=$2 " +
    "AND kind='manual-mapping'", [receipt.plan.caseId, key])).rows[0];
  if (prior) return prior.result;
  const current = TabularSourceProfileSchema.parse(profile);
  assertTabularPin(current.tabular, source);
  if (receipt.plan.tabular.developmentFamily === 'mi-d03') {
    throw new AppError(422, 'TABULAR_CALIBRATION_DENIED', 'The frozen calibration family cannot be fitted online.');
  }
  const bytes = Buffer.from(await readObject(source.object_key));
  if (bytes.length !== Number(source.bytes) || sha256(bytes) !== source.sha256) {
    conflict('The original changed before learning.');
  }
  const examples = persistOfficerBatch(receipt, current, bytes);
  const result = trainOfficerBatch(examples, await activeTabularLearner(client));
  await client.query("INSERT INTO operations(case_id,operation_key,kind,payload_hash,result) " +
    "VALUES($1,$2,'manual-mapping',$3,$4)", [receipt.plan.caseId, key, receipt.planHash, result]);
  return result;
}

/** After commit, use the existing chunk command; busy admission is retried by replaying the same approval request. */
export async function queueApprovedTabular(receipt: TabularMappingReceipt, requestKey: string) {
  const raw = (await query("SELECT id FROM jobs WHERE case_id=$1 AND source_id=$2 AND operation='streaming-vector' " +
    'ORDER BY created_at DESC,id DESC LIMIT 1', [receipt.plan.caseId, receipt.plan.source.sourceId])).rows[0];
  const { ChunkMappingService } = await import('./chunk-mapping');
  const { StreamingVectorService } = await import('./streaming-vector');
  try {
    const rawId = raw?.id ?? (await new StreamingVectorService().enqueue(receipt.plan.caseId,
      receipt.plan.source.sourceId, { requestKey, expectedCaseRevision: receipt.plan.workspaceRevision,
        expectedSourceRevision: receipt.plan.source.sourceRevision, sourceSha256: receipt.plan.source.sourceSha256,
        framing: 'tabular', tabular: receipt.plan.tabular })).jobId;
    await new ChunkMappingService().enqueue(receipt.plan.caseId, receipt.plan.source.sourceId, {
      requestKey, rawJobId: rawId, expectedCaseRevision: receipt.plan.workspaceRevision,
      expectedSourceRevision: receipt.plan.source.sourceRevision, sourceSha256: receipt.plan.source.sourceSha256,
      tabular: receipt.plan.tabular,
    });
  } catch (error) {
    if (!(error instanceof AppError && [409, 429].includes(error.status))) throw error;
  }
}
