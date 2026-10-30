import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, mock, test } from 'node:test';
import type { Pool, PoolClient } from 'pg';
import {
  AnyRetainSourceSchema, TabularMappingReceiptSchema, TabularPinSchema, TabularSourceProfileSchema,
  type TabularSourceProfile,
} from '../packages/contracts/src/usp/ingestion';
import { settings } from '../packages/server/src/infrastructure/config';
import { AppError } from '../packages/server/src/infrastructure/errors';
import { sha256 } from '../packages/server/src/infrastructure/storage';
import { fingerprint } from '../packages/server/src/modules/cases/domain';
import {
  TABULAR_ROW_LIMIT, admitTabularSource, assertTabularPin, inspectTabularSource, readTabularSource,
} from '../packages/server/src/modules/usp/ingestion/tabular-source';
import { ManualIngestionService } from '../packages/server/src/modules/usp/ingestion/service';
import { readStreamingTabular } from '../packages/server/src/modules/usp/ingestion/streaming-vector-reader';
import {
  learnApprovedTabularTx, queueApprovedTabular,
} from '../packages/server/src/modules/usp/ingestion/chunk-mapping-learning';
import { StreamingVectorService } from '../packages/server/src/modules/usp/ingestion/streaming-vector';
import { ChunkMappingService } from '../packages/server/src/modules/usp/ingestion/chunk-mapping';
import { tabularTeacherPolicy } from '../packages/server/src/modules/usp/ingestion/chunk-mapping-tabular';
import { caseOriginalTeacherGate } from '../packages/server/src/modules/usp/ingestion/adaptive-mapping-service';
import { ModelGateway } from '../packages/server/src/modules/model-gateway/gateway';
import { ReplayAdapter } from '../packages/server/src/modules/model-gateway/adapter';
import { ModelGatewayConfigSchema, hash } from '../packages/server/src/modules/model-gateway/config';
import type { PgModelCallLedger } from '../packages/server/src/modules/model-gateway/ledger';
import { TabularChunkMapper } from '../packages/server/src/modules/usp/ingestion/chunk-mapping-agent';
import { officerMappingMethod } from '../packages/server/src/modules/usp/ingestion/tabular-recipe';
import { localRequestContext } from '../packages/server/src/modules/usp/principal';
import {
  columnProfileHash, manualTeacherPlan, mappingContextFromColumnProfile, mappingTeacherRequest,
  proposeMappingWithTeacher,
} from '../packages/server/src/modules/usp/ingestion/mapping-teacher';
import { lookupMappingMemory } from '../packages/server/src/modules/usp/ingestion/mapping-memory';
import { t1OfficerAnswers } from '../scripts/agent/a3c-officer-answers';
import { assertDevelopmentDerivativePin } from '../scripts/golden-journey/govern';
import { createContractValidator } from '../apps/studio/src/local/contract';

const selection = { format: 'csv' as const, sheet: 'csv', table: null, headerRows: [1] };
const manifestPath = 'fixtures/usp/D8-messy-india/manifest.json';
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const development = manifest.assets.find((asset: { id: string }) => asset.id === 'mi-d10-02.csv');
const developmentBytes = readFileSync(development.original.externalPath);
const originalPath = 'E:/BhuAayam-data/datasets/open-property-foreign/dev/d1f/opf-d06/edmonton-heritage.csv';
const originalBytes = readFileSync(originalPath);
const originalHash = '1caa0303fdbcb9c18409154a0529f511b75fd3eb785877990a9718175f97f146';
const validateContract = createContractValidator(JSON.parse(readFileSync('docs/api/openapi.json', 'utf8')));
const globals = globalThis as unknown as { ulpinPool?: Pool };
const requireServer = createRequire(new URL('../packages/server/package.json', import.meta.url));
const { S3Client } = requireServer('@aws-sdk/client-s3');
const { z } = requireServer('zod');
const childProcess = requireServer('node:child_process') as typeof import('node:child_process');
let directory: string;
let savedPool: Pool | undefined;
let savedEnvironment: Record<string, string | undefined>;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'tb6-'));
  savedPool = globals.ulpinPool;
  const names = ['ULPIN_LOCAL_OPERATOR_SUBJECT', 'ULPIN_TABULAR_LEARNING_DIR', 'ULPIN_TABULAR_LEARNER_SEED',
    'ULPIN_TEACHER_CASE_ORIGINALS'];
  savedEnvironment = Object.fromEntries(names.map(name => [name, process.env[name]]));
  delete process.env.ULPIN_TEACHER_CASE_ORIGINALS;
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = 'tb6-protocol-control';
  process.env.ULPIN_TABULAR_LEARNING_DIR = join(directory, 'learning');
  process.env.ULPIN_TABULAR_LEARNER_SEED = join(directory, 'seed-unavailable');
});

afterEach(() => {
  globals.ulpinPool = savedPool;
  for (const [name, value] of Object.entries(savedEnvironment)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  mock.restoreAll();
  rmSync(directory, { recursive: true, force: true });
});

function code(expected: string) {
  return (error: unknown) => error instanceof AppError && error.code === expected;
}

function controlledManifest(change: (value: typeof manifest) => void) {
  const value = structuredClone(manifest);
  change(value);
  const path = join(directory, manifestPath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value));
  const index = join(dirname(path), 'dev/d1c/derivatives.json');
  mkdirSync(dirname(index), { recursive: true });
  writeFileSync(index, JSON.stringify({ derivatives: [] }));
  mock.getter(settings, 'repositoryRoot', () => directory);
}

type SourceRow = {
  id: string; case_id: string; family_id: string; revision: number; name: string; profile: string;
  bytes: number; sha256: string; object_key: string; inspection: {
    actor: string; manualProfile: ReturnType<typeof inspectTabularSource>;
    tabularProvenance?: unknown;
  };
};

class ReceiptProtocol {
  source?: SourceRow;
  caseRevision = 0;
  puts = 0;
  hideNextDuplicate = false;
  sequence = 0;
  receipt: unknown;
  operations = new Map<string, { payload_hash: unknown; result: unknown }>();
  constructor(readonly caseId: string, readonly bytes: Buffer) {}

  reads(sql: string): unknown[] {
    if (sql.includes('pg_advisory_xact_lock')) return [];
    if (sql.includes('FROM registry_case_feature_mappings') || sql.includes('FROM import_packages')) return [];
    if (sql.includes('max(revision)')) return [{ revision: this.source?.revision ?? 0 }];
    if (sql.startsWith('SELECT id,family_id,revision,sha256')) {
      if (!this.source) return [];
      const { id, family_id, revision, sha256: digest } = this.source;
      return [{ id, family_id, revision, sha256: digest }];
    }
    if (sql.includes('FROM cases')) return [{ id: this.caseId, revision: this.caseRevision }];
    if (sql.includes('FROM sources')) {
      if (sql.includes("inspection ? 'manualProfile'") && !this.source?.inspection.manualProfile) return [];
      return this.source ? [this.source] : [];
    }
    if (sql.includes('FROM usp_mapping_recipes')) return [{ body: this.receipt }];
    throw new Error(`Unexpected protocol read: ${sql}`);
  }

  async query(sql: string, args: unknown[] = []) {
    let rows: unknown[] = [];
    if (sql.includes('FROM sources') && sql.includes('sha256=$2') && this.hideNextDuplicate) {
      this.hideNextDuplicate = false;
      return { rows, rowCount: 0 };
    }
    if (sql.includes('FROM operations')) rows = this.operations.has(String(args[1]))
      ? [this.operations.get(String(args[1]))] : [];
    else if (sql.startsWith('INSERT INTO operations')) {
      this.operations.set(String(args[1]), { payload_hash: args[2], result: structuredClone(args[3]) });
    } else if (sql.startsWith('INSERT INTO sources(')) {
      this.source = {
        id: String(args[0]), case_id: String(args[1]), family_id: String(args[2]), revision: Number(args[3]),
        name: String(args[4]), profile: String(args[5]), bytes: Number(args[7]), sha256: String(args[8]),
        object_key: String(args[9]), inspection: args[10] as SourceRow['inspection'],
      };
    } else if (sql.startsWith('UPDATE sources SET mime_type=')) {
      assert(this.source);
      Object.assign(this.source.inspection, JSON.parse(String(args[2])));
    } else if (sql.startsWith('UPDATE cases SET revision=')) this.caseRevision++;
    else if (sql.startsWith('UPDATE usp_outbox_streams')) rows = [{ sequence: String(++this.sequence) }];
    else if (sql.startsWith('SELECT')) rows = this.reads(sql);
    else assert(['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql) || sql.startsWith('INSERT INTO usp_outbox'), sql);
    return { rows, rowCount: rows.length };
  }

  install() {
    const query = this.query.bind(this);
    globals.ulpinPool = { query, connect: async () => ({ query, release() {} }) } as unknown as Pool;
    mock.getter(settings, 's3Endpoint', () => 'http://127.0.0.1:1');
    mock.getter(settings, 's3Region', () => 'us-east-1');
    mock.getter(settings, 's3Bucket', () => 'protocol-control');
    mock.getter(settings, 's3AccessKey', () => 'protocol-control');
    mock.getter(settings, 's3SecretKey', () => 'protocol-control');
    mock.method(S3Client.prototype, 'send', async (command: { constructor: { name: string } }) => {
      if (command.constructor.name === 'PutObjectCommand') {
        this.puts++;
        return {};
      }
      assert.equal(command.constructor.name, 'GetObjectCommand');
      return { Body: Object.assign(Readable.from([this.bytes]), { transformToByteArray: async () => this.bytes }),
        ContentLength: this.bytes.length, ETag: 'protocol-control' };
    });
  }
}

async function retained(provenance = {}, bytes = originalBytes, name = 'edmonton-heritage.csv') {
  assert.equal(sha256(originalBytes), originalHash);
  const protocol = new ReceiptProtocol(randomUUID(), bytes);
  protocol.install();
  const request = { requestKey: randomUUID(), expectedWorkspaceRevision: 0, format: 'csv', selection, ...provenance };
  const service = new ManualIngestionService();
  const result = await service.retain(protocol.caseId, request, { name, bytes });
  const profile = TabularSourceProfileSchema.parse(result);
  assert.deepEqual(validateContract('POST_ingestion_cases_caseId_sources_Response_201_application_json', profile), []);
  return { protocol, request, service, profile };
}

test('new development pins state the reading while old manual-tabular pins parse and fingerprint unchanged', () => {
  const inventory = inspectTabularSource(developmentBytes, selection);
  const oldPin = { selection, sourceBytes: developmentBytes.length,
    developmentAssetId: development.id, developmentFamily: development.family };
  assert.deepEqual(inventory.tabular, { ...oldPin,
    selection: { ...selection, delimiter: ',', encoding: 'utf-8', encodingBasis: 'bom' } });
  assert.equal(fingerprint(TabularPinSchema.parse(oldPin)), fingerprint(oldPin));
  const oldProfile = { version: 'manual-tabular/1', ...inventory,
    source: { sourceId: randomUUID(), familyId: randomUUID(), sourceRevision: 1,
      sourceSha256: sha256(developmentBytes), schemaFingerprint: inventory.schemaFingerprint },
    caseId: randomUUID(), workspaceRevision: 0, workspaceFingerprint: fingerprint('protocol-control') };
  const { schemaFingerprint: _schemaFingerprint, ...stored } = oldProfile;
  assert.deepEqual(TabularSourceProfileSchema.parse(stored), stored);
  assert.deepEqual(tabularTeacherPolicy(inventory.tabular), {
    dataPolicy: { dataClass: 'public', split: 'development' },
  });
});

test('a legacy comma receipt replays and deduplicates without acquiring new reading metadata', async () => {
  const { protocol, request, service, profile } = await retained();
  const legacy = structuredClone(profile);
  delete legacy.tabular.selection.delimiter;
  delete legacy.tabular.selection.encoding;
  delete legacy.profile.delimiter;
  delete legacy.profile.encoding;
  delete legacy.tabular.selection.encodingBasis;
  delete legacy.profile.encodingBasis;
  const inventory = protocol.source!.inspection.manualProfile;
  inventory.tabular = legacy.tabular;
  inventory.profile = legacy.profile;
  inventory.schemaFingerprint = fingerprint({ selection, headers: legacy.headers,
    layout: legacy.profile.layoutFingerprint });
  legacy.source.schemaFingerprint = inventory.schemaFingerprint;
  const operation = protocol.operations.get(`manual-gis:${request.requestKey}`)!;
  operation.result = legacy;
  const file = { name: 'edmonton-heritage.csv', bytes: originalBytes };
  assert.deepEqual(await service.retain(protocol.caseId, request, file), legacy);
  assert.deepEqual(await service.retain(protocol.caseId, { ...request, requestKey: randomUUID() }, file), legacy);
  assert.deepEqual(protocol.source!.inspection.manualProfile.tabular, legacy.tabular);
  assert.equal(protocol.puts, 1);
});

test('known hash with a wrong size cannot use officer provenance to bypass development checks', () => {
  for (const provenance of [{}, { issuer: null, licence: 'open' as const }]) {
    assert.throws(() => admitTabularSource(development.original.sha256, developmentBytes.length + 1, provenance),
      code('TABULAR_DATA_DENIED'));
  }
});

for (const classification of ['wrong_split', 'restricted', 'private', 'held_out']) {
  test(`known ${classification} metadata refuses with and without stated provenance`, () => {
    controlledManifest(value => {
      const asset = value.assets.find((entry: { id: string }) => entry.id === development.id);
      if (classification === 'wrong_split') asset.split = 'not-dev';
      if (classification === 'restricted') asset.permission.state = 'restricted';
      if (classification === 'private') asset.privacy = 'private';
      if (classification === 'held_out') value.heldout.push({ id: asset.family });
    });
    for (const provenance of [{}, { issuer: null, licence: 'open' as const }]) {
      assert.throws(() => admitTabularSource(development.original.sha256, developmentBytes.length, provenance),
        code('TABULAR_DATA_DENIED'));
    }
  });
}

test('an unseen public original is retained without a question and keeps honest unknown provenance', async () => {
  const { protocol, profile } = await retained();
  assert('admission' in profile.tabular);
  assert.deepEqual(profile.tabular.admission, { kind: 'case_original', issuer: null,
    origin: 'officer_supplied', licence: 'unconfirmed', containsPersonalData: 'unknown' });
  assert.deepEqual(protocol.source?.inspection.tabularProvenance, profile.tabular.admission);
  assert.equal(protocol.puts, 1);
  assert.equal(profile.limitations[0], 'An officer supplied this file; its licence is unconfirmed. '
    + 'It is not known whether it contains personal data.');
  assert(profile.limitations.some(line => line.includes('not for development or scoring')));
  assert(profile.limitations.some(line => line.includes('originals kept aside for scoring')
    && line.includes('cannot be recognised here by their hash')));
  assert.doesNotMatch(profile.limitations.join(' '), /officer_supplied|containsPersonalData|D8/);
  assert.equal(profile.records, 1105);
});

test('stated provenance survives retention, both duplicate paths, replay and streaming rows', async () => {
  const provenance = { issuer: 'City of Edmonton', origin: 'officer_supplied',
    licence: 'restricted', containsPersonalData: 'yes' };
  const { protocol, request, service, profile } = await retained(provenance);
  assert('admission' in profile.tabular);
  assert.deepEqual(profile.tabular.admission, { kind: 'case_original', ...provenance });
  assert.equal(profile.tabular.admission.licence, 'restricted');
  assert.equal(profile.tabular.admission.containsPersonalData, 'yes');
  assert.equal(profile.limitations[0], 'An officer supplied this file; its licence is restricted. '
    + 'It contains personal data.');
  const file = { name: 'edmonton-heritage.csv', bytes: originalBytes };
  assert.deepEqual(await service.retain(protocol.caseId, request, file), profile);
  const duplicate = await service.retain(protocol.caseId, { ...request, requestKey: randomUUID() }, file);
  assert.deepEqual(duplicate, profile);
  protocol.hideNextDuplicate = true;
  assert.deepEqual(await service.retain(protocol.caseId, { ...request, requestKey: randomUUID() }, file), profile);
  assert.equal(protocol.puts, 1);
  assertTabularPin(profile.tabular, protocol.source!);
  let rows = 0;
  const streamed = await readStreamingTabular(Readable.from([originalBytes]), profile.tabular, async () => { rows++; });
  assert.equal(rows, profile.records);
  assert.equal(streamed.sha256, originalHash);
  await assert.rejects(service.retain(protocol.caseId, { ...request, requestKey: randomUUID(), licence: 'open' }, file),
    code('TABULAR_PIN_CHANGED'));
});

test('limitation words distinguish unknown personal data from no personal data and keep the stated licence', () => {
  for (const licence of ['unconfirmed', 'open', 'restricted'] as const) {
    for (const containsPersonalData of ['unknown', 'yes', 'no'] as const) {
      const profile = inspectTabularSource(originalBytes, selection, { licence, containsPersonalData });
      const words = { unknown: 'It is not known whether it contains personal data.',
        yes: 'It contains personal data.', no: 'It contains no personal data.' };
      assert.equal(profile.limitations[0], `An officer supplied this file; its licence is ${licence}. `
        + words[containsPersonalData]);
    }
  }
});

test('case provenance remains closed and a case pin cannot acquire development fields', async () => {
  const { profile } = await retained();
  assert(!TabularPinSchema.safeParse({ ...profile.tabular, developmentFamily: development.family }).success);
  assert(!AnyRetainSourceSchema.safeParse({ requestKey: randomUUID(), expectedWorkspaceRevision: 0,
    format: 'csv', selection, origin: 'guessed', issuer: null }).success);
});

test('development-only scripts explicitly refuse a case-original pin before reading labels', async () => {
  const { profile } = await retained();
  assert.throws(() => t1OfficerAnswers(profile), /case original is not development data/);
  assert.throws(() => assertDevelopmentDerivativePin(profile.tabular),
    /Case original cannot be a development derivative/);
});

function approvedReceipt(profile: TabularSourceProfile) {
  const method = officerMappingMethod('tb6-protocol-control');
  const mapping = manualTeacherPlan(profile.profile, 'MAPPING_REVIEW_REQUIRED').plan;
  mapping.method = method;
  mapping.fields[0] = { ...mapping.fields[0], target: 'building.addressLiteral', confidence: 1,
    rationale: 'Use the stated Building Address heading as unresolved address text.' };
  const plan = { version: 'manual-tabular/1', mode: 'manual_mapping', source: profile.source,
    caseId: profile.caseId, workspaceRevision: profile.workspaceRevision,
    workspaceFingerprint: profile.workspaceFingerprint, tabular: profile.tabular, mapping,
    decisions: mapping.fields.map(field => ({ sourceField: field.sourceField,
      reason: field.target === 'unknown' ? 'Leave the field unknown.' : 'Use the stated address without geocoding.',
    })) };
  const planHash = fingerprint({ plan, destination: null });
  return TabularMappingReceiptSchema.parse({ id: randomUUID(), revision: 2, state: 'approved', plan,
    destination: null, planHash, authoredBy: 'tb6-protocol-control', authoredAt: new Date().toISOString(),
    approval: { subject: 'tb6-protocol-control', at: new Date().toISOString(), planHash,
      provenance: 'server_configured_local_operator' }, execution: null });
}

test('approved case mapping is remembered and applied but writes no family-split learning artefacts', async () => {
  const { protocol, profile } = await retained();
  const receipt = approvedReceipt(profile);
  protocol.receipt = receipt;
  const run = mock.method(childProcess, 'spawnSync', () => { throw new Error('Learner must not run.'); });
  const predict = mock.method(childProcess, 'spawn', () => { throw new Error('Learner must not run.'); });
  const client = { query: protocol.query.bind(protocol) } as unknown as PoolClient;
  const outcome = await learnApprovedTabularTx(client, receipt, profile, protocol.source);
  assert.deepEqual(outcome, { learner: 'not_updated', reason: 'case_original_has_no_family' });
  assert.deepEqual(await learnApprovedTabularTx(client, receipt, profile, protocol.source), outcome);
  assert.equal(run.mock.callCount(), 0);
  const root = join(directory, 'learning');
  assert.deepEqual(readdirSync(root), ['accepted-plans.jsonl']);
  const entry = JSON.parse(readFileSync(join(root, 'accepted-plans.jsonl'), 'utf8'));
  assert.equal(entry.lineage.officerDecisionId, `${receipt.id}:${receipt.revision}`);
  assert(!('family' in entry) && !('split' in entry) && !('origin' in entry));
  const memory = lookupMappingMemory(profile.profile.layoutFingerprint,
    mappingContextFromColumnProfile(profile.profile, selection), join(root, 'accepted-plans.jsonl'));
  assert(memory.plan);
  const table = readTabularSource(originalBytes, selection);
  const draft = await new TabularChunkMapper().map({ jobId: randomUUID(), chunkIndex: 0, headers: table.headers,
    rows: table.rows.slice(0, 16), sourceRef: `source:${profile.source.sourceId}`, selection }, {
    context: localRequestContext('tabular-mapping'), authorize: async () => {}, approvedPlan: receipt.plan.mapping,
    memoryPath: join(root, 'accepted-plans.jsonl'), ...tabularTeacherPolicy(profile.tabular),
  });
  assert(draft.proposal.fieldSources.every(field => field.source === 'officer'));
  assert.equal(draft.dryRun.rows.length, 16);
  assert(draft.dryRun.rows.every((row, index) => row.fields[0].value === table.rows[index][0]));
  assert.equal(draft.metrics.teacherCalls, 0);
  const remembered = await new TabularChunkMapper().map({ jobId: randomUUID(), chunkIndex: 0,
    headers: table.headers, rows: table.rows.slice(0, 16), sourceRef: 'protocol-control', selection }, {
    context: localRequestContext('tabular-mapping'), authorize: async () => {},
    memoryPath: join(root, 'accepted-plans.jsonl'), ...tabularTeacherPolicy(profile.tabular),
  });
  assert.equal(remembered.metrics.memoryHits, 1);
  assert.equal(remembered.metrics.teacherCalls, 0);
  assert.equal(predict.mock.callCount(), 0);
});

test('every case-original teacher callback refuses before the request builder is called', async () => {
  const table = readTabularSource(originalBytes, selection);
  const builder = mock.fn(mappingTeacherRequest);
  for (const provenance of [{}, { licence: 'restricted' as const }, { containsPersonalData: 'yes' as const }]) {
    const inventory = inspectTabularSource(originalBytes, selection, provenance);
    const draft = await new TabularChunkMapper().map({ jobId: randomUUID(), chunkIndex: 0, headers: table.headers,
      rows: table.rows.slice(0, 16), sourceRef: 'protocol-control', selection }, {
      context: localRequestContext('tabular-mapping'), authorize: async () => {},
      memoryPath: join(directory, 'missing-memory'),
      teacher: async profile => {
        builder(profile);
        return manualTeacherPlan(profile, 'TEACHER_UNAVAILABLE');
      }, ...tabularTeacherPolicy(inventory.tabular),
    });
    assert(draft.proposal.issues.every(issue => issue.code === 'CASE_ORIGINAL_TEACHER_REFUSED'));
    assert.equal(draft.metrics.teacherCalls, 0);
  }
  assert.equal(builder.mock.callCount(), 0);
});

test('only the exact owner opt-in allows case originals; invalid settings fail closed', () => {
  assert.equal(settings.teacherCaseOriginals, 'off');
  for (const value of ['off', '', 'on', 'MASKED_PROFILE', ' masked_profile ', 'masked_profile']) {
    process.env.ULPIN_TEACHER_CASE_ORIGINALS = value;
    assert.equal(settings.teacherCaseOriginals, value === 'masked_profile' ? 'masked_profile' : 'off');
    assert.equal(caseOriginalTeacherGate().allowed, value === 'masked_profile');
  }
});

test('masked_profile calls the replay teacher once for an admitted LGD case original, never for restricted data',
  async () => {
    process.env.ULPIN_TEACHER_CASE_ORIGINALS = 'masked_profile';
    const bytes = readFileSync('fixtures/usp/D4/reference-area-gurugram-59-63a/lgd-gurugram.csv');
    assert.equal(sha256(bytes), '9214ba1e83683e2735379dd8b17df3269218efde6f6491299b49a1d14a036bce');
    const table = readTabularSource(bytes, selection);
    const config = ModelGatewayConfigSchema.parse({ projectId: 'case-profile-replay', policyVersion: 'test',
      fundingVersion: 'test', gatewayExclusiveFunding: true, indiaPrivateApproved: true,
      secretReference: 'ULPIN_PROVIDER_KEY_TEST', model: 'sarvam-105b', projectCapMicroInr: '1',
      principalDailyCallCap: 1, paceMs: 1500, timeoutMs: 1000,
      inputBound: { version: 'test', maxPromptTokens: 34816 },
      price: { version: 'test', inputPerMillionMicroInr: '1', cachedInputPerMillionMicroInr: '0',
        outputPerMillionMicroInr: '1' } });
    for (const provenance of [{}, { licence: 'open' as const }, { licence: 'restricted' as const },
      { containsPersonalData: 'yes' as const }]) {
      const inventory = inspectTabularSource(bytes, selection, provenance);
      assert('admission' in inventory.tabular);
      const allowed = caseOriginalTeacherGate(inventory.tabular.admission).allowed;
      const replay = mock.fn(async (profile: Parameters<typeof proposeMappingWithTeacher>[0],
        options: Parameters<typeof proposeMappingWithTeacher>[1]) => {
        assert.deepEqual(options.dataPolicy, { dataClass: 'public', split: 'unlabelled' });
        assert(profile.columns.every(column => column.maskedSamples.length === 0));
        const request = mappingTeacherRequest(profile);
        const sent = JSON.parse(request.messages[1].content).columnProfile.columns;
        assert(sent.every((column: { maskedSamples: unknown[] }) => column.maskedSamples.length === 0));
        const output = { fields: request.aliases.map(({ alias: sourceField }) => ({ sourceField,
          target: 'unknown', operation: { kind: 'copy' }, confidence: 'none',
          rationale: 'Administrative labels do not establish building identity.' })) };
        const response = { output, responseHash: hash(output), httpStatus: 200 };
        const adapter = new ReplayAdapter(async replayKey => ({ inputHash: replayKey, replayKey,
          sourceHashes: [columnProfileHash(profile)], responseHash: hash(response), response, eligible: true }));
        const gateway = new ModelGateway(config, { reserve: async () => {
          assert.fail('A replay must never reserve a provider call.');
        } } as unknown as PgModelCallLedger, adapter);
        return proposeMappingWithTeacher(profile, { ...options, gateway });
      });
      const draft = await new TabularChunkMapper().map({ jobId: randomUUID(), chunkIndex: 0,
        headers: table.headers, rows: table.rows, sourceRef: 'protocol-control', selection }, {
        context: localRequestContext('tabular-mapping'), authorize: async () => {},
        memoryPath: join(directory, 'missing-memory'), ...tabularTeacherPolicy(inventory.tabular, replay),
      });
      assert.equal(replay.mock.callCount(), allowed ? 1 : 0);
      assert.equal(draft.metrics.teacherCalls, allowed ? 1 : 0);
      assert.equal(draft.proposal.replayed, allowed);
      if (!allowed) {
        const gate = caseOriginalTeacherGate(inventory.tabular.admission);
        assert(draft.proposal.issues.every(issue => issue.code === gate.code));
        assert(draft.proposal.plan.fields.every(field => field.rationale === gate.words));
      }
    }
    assert.equal(sha256(bytes), '9214ba1e83683e2735379dd8b17df3269218efde6f6491299b49a1d14a036bce');
  });

test('case-original routing still invokes the existing local learner without training', {
  skip: process.env.ULPIN_PROFILE_PYTHON && existsSync(process.env.ULPIN_PROFILE_PYTHON) ? false
    : "needs ULPIN_PROFILE_PYTHON (a Python with the profile reader's packages)",
}, async () => {
  const inventory = inspectTabularSource(originalBytes, selection);
  const table = readTabularSource(originalBytes, selection);
  const draft = await new TabularChunkMapper().map({ jobId: randomUUID(), chunkIndex: 0, headers: table.headers,
    rows: table.rows.slice(0, 16), sourceRef: 'protocol-control', selection }, {
    context: localRequestContext('tabular-mapping'), authorize: async () => {},
    memoryPath: join(directory, 'missing-memory'),
    learnerModelPath: 'E:/BhuAayam-data/task-data/a4/learner/v43', ...tabularTeacherPolicy(inventory.tabular),
  });
  assert.equal(draft.proposal.activeLearnerVersion, 'v43');
  assert.equal(draft.proposal.studentReasonCode, null);
  assert.equal(draft.metrics.teacherCalls, 0);
});

test('the existing row and column bounds still refuse oversized case-original test controls', () => {
  const table = readTabularSource(originalBytes, selection);
  const oversizedRows = Buffer.concat([originalBytes, originalBytes.subarray(originalBytes.indexOf(10) + 1)]);
  assert.throws(() => inspectTabularSource(oversizedRows, selection), { code: TABULAR_ROW_LIMIT,
    message: /more than the whole-file reader takes: 2,000 records.*read as a stream instead; no record is cut/ });
  const control = `${Array(257).fill(table.headers[0]).join(',')}\n${Array(257).fill('').join(',')}\n`;
  assert.throws(() => inspectTabularSource(Buffer.from(control), selection), /256 columns/);
});

test('an approved table queues both jobs with the current case revision and unchanged source pins', async () => {
  const { profile } = await retained();
  const receipt = approvedReceipt(profile);
  const currentRevision = receipt.plan.workspaceRevision + 2;
  const caseRead = mock.fn(async (sql: string, args: unknown[]) => {
    assert.equal(args[0], receipt.plan.caseId);
    if (sql.includes('FROM jobs')) return { rows: [] };
    assert.equal(sql, 'SELECT revision FROM cases WHERE id=$1');
    return { rows: [{ revision: currentRevision }] };
  });
  globals.ulpinPool = { query: caseRead } as unknown as Pool;
  const rawId = randomUUID();
  const raw = mock.method(StreamingVectorService.prototype, 'enqueue', async () => ({ jobId: rawId }));
  const mapping = mock.method(ChunkMappingService.prototype, 'enqueue', async () => ({}));
  const requestKey = randomUUID();
  await queueApprovedTabular(receipt, requestKey);
  assert.equal(raw.mock.callCount(), 1);
  assert.equal(mapping.mock.callCount(), 1);
  for (const call of [raw.mock.calls[0], mapping.mock.calls[0]]) {
    assert.deepEqual(call.arguments.slice(0, 2), [receipt.plan.caseId, receipt.plan.source.sourceId]);
    assert.equal(call.arguments[2].expectedCaseRevision, currentRevision);
    assert.equal(call.arguments[2].expectedSourceRevision, receipt.plan.source.sourceRevision);
    assert.equal(call.arguments[2].sourceSha256, receipt.plan.source.sourceSha256);
    assert.equal(call.arguments[2].requestKey, requestKey);
  }
  assert.equal(mapping.mock.calls[0].arguments[2].rawJobId, rawId);
});

function catalogueAsset(value: unknown, id: string): unknown {
  if (!value || typeof value !== 'object') return undefined;
  if (!Array.isArray(value) && 'id' in value && value.id === id) return value;
  for (const child of Object.values(value)) {
    const found = catalogueAsset(child, id);
    if (found) return found;
  }
  return undefined;
}

test('good and difficult unseen tables retain and read with their recorded licence state', async () => {
  const catalogue = JSON.parse(readFileSync('docs/api/datasets.json', 'utf8'));
  const assetSchema = z.object({ id: z.string(), permission: z.object({ state: z.literal('unconfirmed') }),
    content: z.object({ externalPath: z.string(), sha256: z.string(), bytes: z.number() }) });
  const outcomes = [];
  for (const id of ['edmonton-heritage.csv', 'kansas-municipal.csv']) {
    const asset = assetSchema.parse(catalogueAsset(catalogue, id));
    const bytes = readFileSync(asset.content.externalPath);
    assert.equal(sha256(bytes), asset.content.sha256);
    assert.equal(bytes.length, asset.content.bytes);
    const { profile, protocol } = await retained({ licence: asset.permission.state }, bytes, id);
    assert('admission' in profile.tabular);
    let rows = 0;
    const read = await readStreamingTabular(Readable.from([bytes]), profile.tabular, async () => { rows++; });
    assert.equal(read.sha256, asset.content.sha256);
    assert.equal(rows, profile.records);
    assert.equal(protocol.puts, 1);
    const refusal = await tabularTeacherPolicy(profile.tabular).teacher!(profile.profile);
    assert(refusal.issues.every(issue => issue.code === 'CASE_ORIGINAL_TEACHER_REFUSED'));
    outcomes.push({ name: id, sha256: read.sha256, bytes: bytes.length,
      recordedLicenceState: asset.permission.state, requestedLicence: asset.permission.state,
      admission: profile.tabular.admission.kind, issuer: null, containsPersonalData: 'unknown',
      rows, columns: profile.headers.length, headers: profile.headers, outcome: 'retained_and_read',
      teacherCode: refusal.issues[0].code, runtimeRequests: 0, providerCalls: 0 });
  }
  if (process.env.ULPIN_TB6_WRITE_EVIDENCE === '1') {
    writeFileSync('docs/evidence/gf1/tb6/real-inputs.json', JSON.stringify(outcomes, null, 2) + '\n');
  }
});
