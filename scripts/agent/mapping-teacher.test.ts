import test from 'node:test';
import fixtures from './mapping-teacher.fixtures.json';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ColumnProfileDocumentSchema } from '../../packages/contracts/src/index';
import {
  goodFile,
  difficultFile,
  controlConfig,
  ControlLedger,
  unknownResponse,
  options,
} from './control-runtime';
import {
  profileColumnFile,
  profileColumns,
  maskColumnSample,
} from '../../packages/server/src/modules/usp/ingestion/column-profile';
import {
  proposeMappingWithTeacher,
  proposeMapping,
  manualTeacherPlan,
  mappingTeacherRequest,
  executeTeacherMappingDryRun,
  columnProfileHash,
  teacherReplayKey,
  validateTeacherOutput,
  mappingContextFromColumnProfile,
} from '../../packages/server/src/modules/usp/ingestion/mapping-teacher';
import {
  ingestTeacherLabels,
  DEVELOPMENT_TEACHER_METHODS,
} from '../../packages/server/src/modules/usp/ingestion/teacher-labels';
import { validateMappingPlanV2 } from '../../packages/server/src/modules/usp/ingestion/mapping-plan-v2';
import { ModelGateway } from '../../packages/server/src/modules/model-gateway/gateway';
import { AppError } from '../../packages/server/src/infrastructure/errors';
import { TabularChunkMapper } from '../../packages/server/src/modules/usp/ingestion/chunk-mapping-agent';
import { hash } from '../../packages/server/src/modules/model-gateway/config';
import {
  ControlAdapter,
  ReplayAdapter,
  SarvamAdapter,
  classifyProviderFailure,
  minimizeMessages,
  type ProviderRequest,
  type ProviderResult,
} from '../../packages/server/src/modules/model-gateway/adapter';
import { TeacherRecordings } from '../../packages/server/src/modules/model-gateway/recordings';
import { PgModelCallLedger, type Transact } from '../../packages/server/src/modules/model-gateway/ledger';
import { prepareTable } from './t1-profiles';
import { developmentProfileAssets, sourceTables, type SourceAsset } from './t1-sources';

test('profile: evidence-only units, disagreement, shapes and conservative PII masks', () => {
  const rows = fixtures.profileRows;
  const profile = profileColumns(
    rows,
    Object.keys(rows[0]).map((name) => ({ name })),
    'tabular',
  );
  assert(ColumnProfileDocumentSchema.safeParse(profile).success);
  assert.equal(profile.sampleShortfall, false);
  assert.equal(profile.columns[0].declaredUnit, 'ft2');
  assert.equal(profile.columns[1].declaredUnit, undefined);
  assert.equal(profile.columns[2].valueShapes.floorLabelRate, 1);
  assert(
    profile.columns[3].valueShapes.devanagariDigitRate !== null &&
      profile.columns[3].valueShapes.devanagariDigitRate > 0,
  );
  assert(
    profile.columns[0].valueShapes.lakhGroupingRate !== null &&
      profile.columns[0].valueShapes.lakhGroupingRate > 0,
    'Grouping shape survives declared suffixes.',
  );
  const sent = JSON.parse(mappingTeacherRequest(profile).messages[1].content).columnProfile.columns;
  assert.deepEqual(
    sent[0].maskedSamples,
    profile.columns[0].maskedSamples.map((sample) => (sample === '[blank]' ? '(blank cell)' : sample)),
    'Already masked shape samples stay as they are; the blank token goes in its plain-text form.',
  );
  assert.equal(profile.columns[3].valueShapes.khasraLikeRate, 1);
  for (const column of profile.columns) assert.equal(column.maskedSamples.length, 5);
  const masked = JSON.stringify(profile.columns[5].maskedSamples);
  for (const privateValue of fixtures.privateValues) assert(!masked.includes(privateValue));
  assert.equal(
    profileColumns([{ Area: '123' }], [{ name: 'Area' }], 'tabular').columns[0].declaredUnit,
    undefined,
  );
  assert.equal(
    profileColumns([{ Area: '123 sq.m' }], [{ name: 'Area' }], 'tabular').columns[0].declaredUnit,
    'm2',
  );
  assert.equal(
    profileColumns([{ 'Area (ft2) (ft)': '123' }], [{ name: 'Area (ft2) (ft)' }], 'tabular').columns[0]
      .declaredUnit,
    undefined,
  );
  assert.equal(
    profileColumns([{ 'Area (m2)': '123 ft2' }], [{ name: 'Area (m2)' }], 'tabular').columns[0].declaredUnit,
    undefined,
  );
  assert(!maskColumnSample('Private Personal Name', 'notes').includes('Private'));
  const unavailable = profileColumns([{}, { Empty: null }, { Empty: '' }], [{ name: 'Empty' }], 'tabular')
    .columns[0];
  assert.equal(unavailable.valueShapes.nullRate, 1 / 3);
  assert.equal(unavailable.valueShapes.absentRate, 1 / 3);
  assert.equal(unavailable.valueShapes.blankRate, 1 / 3);
  assert.equal(unavailable.valueShapes.distinctRatio, null);
  assert.equal(profileColumns([], [{ name: 'Empty' }], 'tabular').columns[0].valueShapes.nullRate, null);
});

test('request: the four whole-sample tokens go as plain-text forms the minimizer accepts; cell text stays text', () => {
  const rows = [
    { gap: '', compound: [1], note: '(blank cell)' },
    { compound: { key: 1 }, note: '(object cell)' },
  ];
  const profile = profileColumns(rows, [{ name: 'gap' }, { name: 'compound' }, { name: 'note' }], 'tabular');
  const tokens = [['[blank]', '[absent]'], ['[array]', '[object]']];
  const text = ['(blank xxxx)', '(object xxxx)'];
  assert.deepEqual(profile.columns.map((column) => column.maskedSamples), [...tokens, text]);
  const refused = [{ role: 'user', content: JSON.stringify({ samples: tokens.flat() }) }];
  assert.throws(() => minimizeMessages(refused), { code: 'MODEL_PROMPT_PRIVACY' });

  const request = mappingTeacherRequest(profile);
  const sent = (messages: unknown) =>
    JSON.parse(minimizeMessages(messages)[1].content).columnProfile.columns.map(
      (column: { maskedSamples: string[] }) => column.maskedSamples,
    );
  const forms = [['(blank cell)', '(absent cell)'], ['(array cell)', '(object cell)']];
  assert.deepEqual(sent(request.messages), [...forms, text]);
  assert.deepEqual(request.sampleForms, [
    { token: '[absent]', form: '(absent cell)', samples: 1 },
    { token: '[blank]', form: '(blank cell)', samples: 1 },
    { token: '[array]', form: '(array cell)', samples: 1 },
    { token: '[object]', form: '(object cell)', samples: 1 },
  ]);

  // A stored sample that already reads as a form is masked again as text, never passed through as a token.
  const stored = { ...profile, columns: profile.columns.map((column) => ({ ...column, maskedSamples: forms[0] })) };
  assert.deepEqual(sent(mappingTeacherRequest(stored).messages), Array(3).fill(['(blank xxxx)', '(absent xxxx)']));
  assert.deepEqual(mappingTeacherRequest(stored).sampleForms, []);
});

test('gateway: a message that is only too long is refused as size; shape and content refusals stay privacy', () => {
  const long = 'x'.repeat(32769);
  assert.equal(minimizeMessages([{ role: 'user', content: 'x'.repeat(20000) }]).length, 1);
  assert.throws(() => minimizeMessages([{ role: 'user', content: long }]), { code: 'MODEL_INPUT_LIMIT', status: 413 });
  assert.throws(() => minimizeMessages([{ role: 'user', content: `${long} data:` }]), { code: 'MODEL_PROMPT_PRIVACY' });
  assert.throws(() => minimizeMessages([{ role: 'tool', content: long }]), { code: 'MODEL_PROMPT_PRIVACY' });
});

const requestHash = (request: ReturnType<typeof mappingTeacherRequest>) =>
  createHash('sha256').update(JSON.stringify([request.messages, request.schema])).digest('hex');
const sentColumns = (request: ReturnType<typeof mappingTeacherRequest>) =>
  JSON.parse(request.messages[1].content).columnProfile.columns as
    { header: string; sourceField: string; maskedSamples: string[] }[];

/** Ten rows of made-up text under made-up headers: nothing here is read from a source. */
function madeUpProfile(width: number) {
  const names = Array.from({ length: width }, (_, index) => `Field ${index + 1}`);
  const rows = Array.from({ length: 10 }, (_, row) =>
    Object.fromEntries(names.map((name, column) => [name, `value ${row} of ${column}`])),
  );
  return profileColumns(rows, names.map((name) => ({ name })), 'tabular');
}

/** Asks the teacher through a gateway that counts; returns what the gateway and its ledger saw. */
async function askCounted(profile: ReturnType<typeof madeUpProfile>) {
  const ledger = new ControlLedger();
  let asked = 0;
  const adapter = new ControlAdapter(async (request) => {
    asked++;
    return unknownResponse(request);
  });
  const result = await proposeMappingWithTeacher(profile, options(new ModelGateway(controlConfig(), ledger, adapter)));
  return { result, asked, reserved: ledger.reserved, dispatched: ledger.dispatched };
}

test('size: a request within the bound is built as before, with every sample', () => {
  // Hashes of the messages and schema for the two retained inputs, measured on the base 39ed2dbb.
  const before = [
    '533f7722234e603bc3b07aef5c57bd0f0d72af716b801dfeda5931a518532d22',
    '067a245bb3141442c9d94acd646ecf4609b989047012fbe2c6d50c939db4c1e9',
  ];
  for (const [index, file] of [goodFile, difficultFile].entries()) {
    const { profile } = profileColumnFile(file);
    const request = mappingTeacherRequest(profile);
    assert.equal(requestHash(request), before[index], file);
    const most = Math.max(...profile.columns.map((column) => column.maskedSamples.length));
    assert.deepEqual([request.samplesPerColumn, request.overBound], [most, false], file);
  }
});

test('size: a request over the bound carries fewer samples in every column; columns and order stay', async () => {
  const profile = madeUpProfile(40);
  const whole = { ...profile, columns: profile.columns.map((column) => ({ ...column, maskedSamples: [] })) };
  const request = mappingTeacherRequest(profile);
  assert.deepEqual([request.samplesPerColumn, request.overBound], [7, false]);
  assert.equal(minimizeMessages(request.messages).length, 2);
  const [sent, bare] = [sentColumns(request), sentColumns(mappingTeacherRequest(whole))];
  assert.equal(sent.length, 40);
  assert(sent.every((column) => column.maskedSamples.length === 7));
  const named = (columns: typeof sent) => columns.map((column) => [column.header, column.sourceField]);
  assert.deepEqual(named(sent), named(bare));
  // One sample more in every column is over the bound: the step down stopped at the first number that fits.
  const eight = sent.map((column) => ({ ...column, maskedSamples: [...column.maskedSamples, 'xxxxx D xx D'] }));
  const user = JSON.parse(request.messages[1].content);
  const longer = JSON.stringify({ ...user, columnProfile: { ...user.columnProfile, columns: eight } });
  assert.throws(() => minimizeMessages([request.messages[0], { role: 'user', content: longer }]), {
    code: 'MODEL_INPUT_LIMIT',
  });

  const asked = await askCounted(profile);
  assert.deepEqual([asked.asked, asked.reserved, asked.dispatched, asked.result.attempts], [1, 1, 1, 1]);
  assert(asked.result.issues.every((issue) => issue.code !== 'TEACHER_INPUT_LIMIT'));
});

test('size: a request over the bound with no samples is refused as size and the gateway is not asked', async () => {
  const profile = madeUpProfile(60);
  const request = mappingTeacherRequest(profile);
  assert.deepEqual([request.samplesPerColumn, request.overBound, sentColumns(request).length], [0, true, 60]);
  assert.throws(() => minimizeMessages(request.messages), { code: 'MODEL_INPUT_LIMIT' });
  const { result, ...counts } = await askCounted(profile);
  assert.deepEqual(counts, { asked: 0, reserved: 0, dispatched: 0 });
  assert.deepEqual([result.state, result.attempts], ['needs_input', 0]);
  assert.equal(result.plan.method, 'manual:TEACHER_INPUT_LIMIT');
  assert.equal(result.gatewayRefusal, undefined);
  assert(result.issues.length > 0 && result.issues.every((issue) => issue.code === 'TEACHER_INPUT_LIMIT'));
  assert(validateMappingPlanV2({ ...result.plan, method: 'reviewer:control' },
    mappingContextFromColumnProfile(profile)).success);
});

/** A recorded table prepared as the screen prepares it: the profile under its literal headers. */
function screenedProfile(asset: SourceAsset) {
  const prepared = prepareTable(asset, sourceTables(asset)[0]);
  const columns = prepared.inventory.profile.columns.map((column, index) => {
    const header = prepared.profiles[index].header;
    return { ...column, name: header.trim() ? header : column.name };
  });
  return { ...prepared.inventory.profile, columns };
}

test('size: the two recorded mi-d22 tables are over the bound with no samples, so the rule refuses them', async () => {
  const wide = developmentProfileAssets().filter((asset) => asset.family === 'mi-d22');
  const measured: number[][] = [];
  for (const asset of wide) {
    const profile = screenedProfile(asset);
    const request = mappingTeacherRequest(profile);
    assert.deepEqual([request.samplesPerColumn, request.overBound, request.sampleForms], [0, true, []], asset.id);
    measured.push([sentColumns(request).length, request.messages[1].content.length,
      Buffer.byteLength(JSON.stringify(request.messages))]);
    const { result, ...counts } = await askCounted(profile);
    assert.deepEqual(counts, { asked: 0, reserved: 0, dispatched: 0 }, asset.id);
    assert(result.issues.every((issue) => issue.code === 'TEACHER_INPUT_LIMIT'), asset.id);
  }
  // Columns, characters of the user message and bytes of both messages with no samples, as Step 0 measured them.
  assert.deepEqual(measured.sort((a, b) => b[1] - a[1]), [[90, 33178, 37690], [90, 33054, 37566]]);
});

test('refusal: failed and routed results preserve the asked gateway code and retryable flag', async () => {
  const { profile } = profileColumnFile(goodFile);
  for (const retryable of [true, false]) {
    const adapter = new ControlAdapter(async request => unknownResponse(request));
    const gateway = new ModelGateway(controlConfig(), new ControlLedger(), adapter);
    gateway.propose = async () => {
      throw new AppError(503, 'MODEL_QUOTA_EXHAUSTED', 'Software refusal', { retryable });
    };
    const direct = await proposeMappingWithTeacher(profile, options(gateway));
    const routed = await proposeMapping(profile, { ...options(gateway), memoryPath: join(tmpdir(), 's6-no-memory') });
    for (const result of [direct, routed]) {
      assert.deepEqual(result.gatewayRefusal, { code: 'MODEL_QUOTA_EXHAUSTED', retryable });
      assert(result.issues.some(issue => issue.code === 'TEACHER_BUDGET_EXHAUSTED'));
    }
    const mapper = new TabularChunkMapper();
    const draft = await mapper.map({ jobId: randomUUID(), chunkIndex: 0, headers: ['Field'], rows: [['value']],
      sourceRef: 'software-control' }, { ...options(gateway), memoryPath: join(tmpdir(), 's6-no-memory') });
    assert.deepEqual(draft.proposal.gatewayRefusal, direct.gatewayRefusal);
  }
  // Even when routing rejects a supplied plan and builds a fresh fallback, the refusal is kept.
  const fallback = manualTeacherPlan(profile, 'TEACHER_BUDGET_EXHAUSTED');
  const refusal = { code: 'MODEL_QUOTA_EXHAUSTED', retryable: true };
  const rejected = await proposeMapping(profile, { ...options(), memoryPath: join(tmpdir(), 's6-no-memory'),
    teacher: async () => ({ ...fallback, plan: { ...fallback.plan, fields: [] }, gatewayRefusal: refusal }) });
  assert.deepEqual(rejected.gatewayRefusal, refusal);
});

test('two retained Indian inputs: profile to control plan, validator and dry-run; source immutable', async () => {
  for (const path of [goodFile, difficultFile]) {
    const before = hash(readFileSync(path).toString('base64')),
      input = profileColumnFile(path),
      ledger = new ControlLedger();
    const gateway = new ModelGateway(
      controlConfig(),
      ledger,
      new ControlAdapter(async (request) => {
        const sent = JSON.parse(request.messages[1].content).columnProfile.columns;
        assert.equal(
          sent[0].header,
          input.profile.columns[0].name,
          'The shared personal-name minimizer must not erase headers.',
        );
        assert.equal(sent[0].name, undefined);
        return unknownResponse(request);
      }),
    );
    const result = await proposeMappingWithTeacher(input.profile, options(gateway));
    assert(validateMappingPlanV2(result.plan, mappingContextFromColumnProfile(input.profile)).success);
    const dry = executeTeacherMappingDryRun(result, input.rows, {
      ...mappingContextFromColumnProfile(input.profile),
      sourceRef: path,
    });
    assert.equal(dry.counts.needsInput, dry.counts.cells);
    assert.equal(dry.counts.candidate, 0);
    assert.equal(result.attempts, 1);
    assert.equal(ledger.dispatched, 1);
    assert.equal(ledger.settled, 1);
    assert.equal(ledger.calls.values().next().value!.actual_micro_inr, '131760');
    assert.equal(hash(readFileSync(path).toString('base64')), before);
    if (path === difficultFile)
      assert.equal(input.profile.columns.find((c) => c.name === 'Area')?.declaredUnit, undefined);
  }
});

test('recordings replay by template/profile/model across invocation scope without paid debit', async () => {
  const input = profileColumnFile(goodFile),
    recordings = new TeacherRecordings(mkdtempSync(join(tmpdir(), 'a2-replay-')));
  const liveControl = new ModelGateway(
    controlConfig(),
    new ControlLedger(),
    new ControlAdapter(async (request) => unknownResponse(request)),
  );
  const first = await proposeMappingWithTeacher(input.profile, { ...options(liveControl), recordings });
  const entries = readdirSync(recordings.directory);
  assert.equal(entries.length, 1);
  const record = JSON.parse(readFileSync(join(recordings.directory, entries[0]), 'utf8').trim());
  assert.equal(record.costMicroInr, '131760');
  assert.equal(record.validation.success, true);
  assert.equal(record.adapterKind, 'control');
  assert.equal(
    await recordings.replay(record.replayKey, ['sarvam']),
    undefined,
    'Default runtime replay must not enroll software controls.',
  );
  assert.equal(record.profileHash, columnProfileHash(input.profile));
  assert.equal(record.replayKey, teacherReplayKey(record.profileHash));
  const ledger = new ControlLedger();
  ledger.denyCode = 'MODEL_PROJECT_CAP';
  const replay = new ModelGateway(
    { ...controlConfig(), policyVersion: 'different-offline-policy' },
    ledger,
    new ReplayAdapter((key) => recordings.replay(key)),
  );
  const second = await proposeMappingWithTeacher(input.profile, {
    ...options(replay),
    invocationKey: 'different-invocation',
  });
  assert.equal(second.replayed, true);
  assert.deepEqual(second.plan, first.plan);
  assert.equal(ledger.reserved, 0);
  assert.equal(await recordings.replay(hash('different-profile')), undefined);
});

test('each provider/key/admission failure fails closed; no transport retry, manual mapping remains valid', async () => {
  const input = profileColumnFile(goodFile);
  const cases = [
    [
      '401',
      () => {
        throw classifyProviderFailure(401, 'authentication_error', null);
      },
      'TEACHER_AUTH_FAILED',
    ],
    [
      '402',
      () => {
        throw classifyProviderFailure(402, undefined, null);
      },
      'TEACHER_BUDGET_EXHAUSTED',
    ],
    [
      '429',
      () => {
        throw classifyProviderFailure(429, 'rate_limit_exceeded_error', '1');
      },
      'TEACHER_RATE_LIMITED',
    ],
    [
      'credit',
      () => {
        throw classifyProviderFailure(429, 'insufficient_quota_error', null);
      },
      'TEACHER_BUDGET_EXHAUSTED',
    ],
    [
      'network',
      () => {
        throw new Error('Control network failure');
      },
      'TEACHER_UNAVAILABLE',
    ],
    [
      'timeout',
      (request: ProviderRequest) =>
        new Promise<ProviderResult>((_, reject) =>
          request.signal.addEventListener('abort', () => reject(new Error('Control timeout')), {
            once: true,
          }),
        ),
      'TEACHER_UNAVAILABLE',
    ],
  ] as const;
  for (const [name, control, code] of cases) {
    const ledger = new ControlLedger(),
      config = { ...controlConfig(), timeoutMs: name === 'timeout' ? 10 : 1000 };
    const result = await proposeMappingWithTeacher(
      input.profile,
      options(new ModelGateway(config, ledger, new ControlAdapter(async (request) => control(request)))),
    );
    assert.equal(result.state, 'needs_input', name);
    assert(
      result.issues.every((issue) => issue.code === code),
      name,
    );
    assert.equal(ledger.dispatched, 1, name);
    assert.equal(ledger.exposure, 1, name);
    assert.equal(result.attempts, 1, name);
    const manual = { ...result.plan, method: 'reviewer:control' };
    assert(validateMappingPlanV2(manual, mappingContextFromColumnProfile(input.profile)).success, name);
  }
  for (const code of ['MODEL_PROJECT_CAP', 'MODEL_DAILY_CAP', 'MODEL_PRINCIPAL_CAP']) {
    const ledger = new ControlLedger();
    ledger.denyCode = code;
    const result = await proposeMappingWithTeacher(
      input.profile,
      options(
        new ModelGateway(
          controlConfig(),
          ledger,
          new ControlAdapter(async (request) => unknownResponse(request)),
        ),
      ),
    );
    assert(result.issues.every((issue) => issue.code === 'TEACHER_BUDGET_EXHAUSTED'));
    assert.equal(ledger.dispatched, 0);
  }
  const missingKey = await proposeMappingWithTeacher(input.profile, options());
  assert(missingKey.issues.every((issue) => issue.code === 'TEACHER_UNAVAILABLE'));
  assert.equal(missingKey.attempts, 0);
  const nullableProfile = profileColumns([{ Empty: null }, {}], [{ name: 'Empty' }], 'tabular');
  const nullable = await proposeMappingWithTeacher(nullableProfile, options());
  const nullableDry = executeTeacherMappingDryRun(nullable, [{ Empty: null }, {}], {
    ...mappingContextFromColumnProfile(nullableProfile),
    sourceRef: 'control-only',
  });
  assert.equal(nullableDry.rows[0].fields[0].state, 'null');
  assert.equal(nullableDry.rows[1].fields[0].state, 'absent');
  assert.equal(nullableDry.rows[0].fields[0].issueCode, 'TEACHER_UNAVAILABLE');
});

test('private, restricted and held-out profiles never reach a teacher; absent replay stays manual', async () => {
  const input = profileColumnFile(goodFile);
  let calls = 0;
  const gateway = new ModelGateway(
    controlConfig(),
    new ControlLedger(),
    new ControlAdapter(async (request) => {
      calls++;
      return unknownResponse(request);
    }),
  );
  for (const dataPolicy of [
    { dataClass: 'private', split: 'development' },
    { dataClass: 'restricted', split: 'development' },
    { dataClass: 'public', split: 'held_out' },
  ] as const) {
    const result = await proposeMappingWithTeacher(input.profile, { ...options(gateway), dataPolicy });
    assert(result.issues.every((issue) => issue.code === 'TEACHER_DATA_DENIED'));
    assert.equal(result.attempts, 0);
  }
  assert.equal(calls, 0);
  const replay = await proposeMappingWithTeacher(
    input.profile,
    options(new ModelGateway(controlConfig(), new ControlLedger(), new ReplayAdapter(async () => undefined))),
  );
  assert(replay.issues.every((issue) => issue.code === 'TEACHER_REPLAY_UNAVAILABLE'));
});

test('one schema repair with codes; literal output rejected; only valid fields survive exhausted repair', async () => {
  const profile = profileColumns(
    [{ Name: 'Residential', Area: '123 sq ft' }],
    [{ name: 'Name' }, { name: 'Area' }],
    'tabular',
  );
  let calls = 0;
  const adapter = new ControlAdapter(async (request) => {
    calls++;
    const input = JSON.parse(request.messages[1].content);
    if (calls === 2) assert(input.validationErrorCodes.includes('MAPPING_TEACHER_SCHEMA_INVALID'));
    const output = {
      fields: fixtures.invalidTeacherFields.map((field, index) => ({
        ...field,
        sourceField: input.columnProfile.columns[index].sourceField,
      })),
    };
    return { ...unknownResponse(request), output };
  });
  const result = await proposeMappingWithTeacher(
    profile,
    options(new ModelGateway(controlConfig(), new ControlLedger(), adapter)),
  );
  assert.equal(calls, 2);
  assert.equal(result.attempts, 2);
  assert.equal(result.plan.fields[0].target, 'building.name');
  assert.equal(result.plan.fields[1].target, 'unknown');
  assert.equal(result.issues.length, 1);
  const request = mappingTeacherRequest(profile);
  const positive = {
    fields: fixtures.validTeacherFields.map((field, index) => ({
      ...field,
      sourceField: request.aliases[index].alias,
    })),
  };
  assert(validateTeacherOutput(positive, profile).success);
});

test('development labels: strict validator, pseudo-labels, held-out exclusion and dry-run', async () => {
  const input = profileColumnFile(goodFile),
    profileHash = columnProfileHash(input.profile),
    directory = mkdtempSync(join(tmpdir(), 'a2-labels-'));
  const result = await proposeMappingWithTeacher(
    input.profile,
    options(
      new ModelGateway(
        controlConfig(),
        new ControlLedger(),
        new ControlAdapter(async (request) => unknownResponse(request)),
      ),
    ),
  );
  const plan = { ...result.plan, method: DEVELOPMENT_TEACHER_METHODS['claude-opus-5-5'] },
    labels = join(directory, 'teacher-labels.jsonl');
  writeFileSync(
    labels,
    [
      { profileHash, plan, method: DEVELOPMENT_TEACHER_METHODS['claude-opus-5-5'] },
      {
        profileHash,
        plan: {
          ...plan,
          fields: plan.fields.map((f) => ({ ...f, operation: { kind: 'copy', epsg: 'EPSG:4326' } })),
        },
        method: DEVELOPMENT_TEACHER_METHODS['claude-opus-5-5'],
      },
    ]
      .map((v) => JSON.stringify(v))
      .join('\n'),
  );
  const profiles = new Map([
    [
      profileHash,
      {
        profile: input.profile,
        dataPolicy: { dataClass: 'public' as const, split: 'development' as const },
        rows: input.rows,
        sourceRef: goodFile,
      },
    ],
  ]);
  const output = join(directory, 'pseudo-labels.jsonl'),
    report = await ingestTeacherLabels(labels, profiles, output);
  assert.equal(report.accepted, 1);
  assert.equal(report.rejected, 1);
  assert.equal(report.examples, input.profile.columns.length);
  const examples = readFileSync(output, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert(
    examples.every(
      (e) => e.labelKind === 'pseudo_label' && e.verified === true &&
        e.method === DEVELOPMENT_TEACHER_METHODS['claude-opus-5-5'],
    ),
  );
  const denied = await ingestTeacherLabels(
    labels,
    new Map([
      [
        profileHash,
        { ...profiles.get(profileHash)!, dataPolicy: { dataClass: 'public', split: 'held_out' } },
      ],
    ]),
    join(directory, 'denied.jsonl'),
  );
  assert.equal(denied.accepted, 0);
});

function developmentLabelFixture(method: string) {
  const input = profileColumnFile(goodFile);
  const profileHash = columnProfileHash(input.profile);
  const directory = mkdtempSync(join(tmpdir(), 't2-labels-'));
  const plan = {
    version: 'mapping-plan/2', sourceKind: input.profile.sourceKind,
    layoutFingerprint: input.profile.layoutFingerprint, method,
    fields: input.profile.columns.map(column => ({
      sourceField: column.name, target: 'unknown', operation: { kind: 'copy' }, confidence: 0,
      rationale: 'Software-control schema check; no interpretation supplied.',
    })),
  };
  const labels = join(directory, 'labels.jsonl');
  writeFileSync(labels, JSON.stringify({ profileHash, plan, method }) + '\n');
  const profiles = new Map([[profileHash, {
    profile: input.profile, rows: input.rows, sourceRef: goodFile,
    dataPolicy: { dataClass: 'public' as const, split: 'development' as const },
  }]]);
  return { labels, profiles, output: join(directory, 'pseudo-labels.jsonl'), profileHash, plan };
}

test('development labels accept gpt-6.1-sol and preserve its method on every example', async () => {
  const method = DEVELOPMENT_TEACHER_METHODS['gpt-6.1-sol'];
  const { labels, profiles, output, profileHash, plan } = developmentLabelFixture(method);
  writeFileSync(labels, [
    { profileHash, plan, method },
    { profileHash, plan, method: DEVELOPMENT_TEACHER_METHODS['claude-opus-5-5'] },
  ].map(label => JSON.stringify(label)).join('\n'));
  const report = await ingestTeacherLabels(labels, profiles, output);
  assert.equal(report.accepted, 1);
  assert.equal(report.rejected, 1);
  assert.deepEqual(report.rejections[0].codes, ['TEACHER_LABEL_METHOD_MISMATCH']);
  const examples = readFileSync(output, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.equal(examples.length, plan.fields.length);
  assert(examples.every(example => example.method === 'model:gpt-6.1-sol@dev-2026-10'));
});

test('development labels refuse a third model id before accepting any examples', async () => {
  const { labels, profiles, output } = developmentLabelFixture('model:other@dev-2026-10');
  const report = await ingestTeacherLabels(labels, profiles, output);
  assert.equal(report.accepted, 0);
  assert.equal(report.rejected, 1);
  assert.deepEqual(report.rejections[0].codes, ['TEACHER_LABEL_SCHEMA_INVALID']);
  assert.equal(readFileSync(output, 'utf8'), '');
});

test('actual existing Pg ledger enforces optional daily money cap before dispatch', async () => {
  const config = { ...controlConfig(), projectDailyCapMicroInr: '1' };
  let dispatched = false;
  const tx: Transact = async (action) =>
    action({
      query: async (sql: string) => {
        if (sql.startsWith('INSERT INTO usp_model_budget')) return { rows: [] };
        if (sql.includes('FROM usp_model_budget'))
          return {
            rows: [{ config_hash: ledger.configHash, credential_hash: hash('control'), now: new Date() }],
          };
        if (sql.includes('count(*)')) return { rows: [{ count: 0 }] };
        if (sql.includes('COALESCE(sum')) return { rows: [{ total: '0', other: '0' }] };
        if (sql.startsWith('SELECT')) return { rows: [] };
        dispatched = true;
        throw new Error('No admission insert permitted');
      },
    } as any);
  const ledger = new PgModelCallLedger(tx, config, hash('control'), 'control');
  await assert.rejects(
    ledger.reserve({
      principalHash: hash('control'),
      invocationKey: hash('control'),
      attempt: 1,
      consumer: 'INGEST',
      inputHash: hash('input'),
      scopeHash: hash('scope'),
      sourceHashes: [],
      deadlineAt: new Date(Date.now() + 1000),
    }),
    (error: any) => error.code === 'MODEL_DAILY_CAP',
  );
  assert.equal(dispatched, false);
});

test('fake Sarvam records success and HTTP failures; recording is required before dispatch', async () => {
  const input = profileColumnFile(goodFile),
    recordings = new TeacherRecordings(mkdtempSync(join(tmpdir(), 'a2-fake-live-')));
  let fetches = 0;
  const adapter = new SarvamAdapter('control-only-not-a-live-key', (async (_url, init) => {
    fetches++;
    const body = JSON.parse(String(init?.body));
    if (fetches === 2)
      return Response.json(
        { error: { code: 'insufficient_quota_error', message: 'control-only-not-a-live-key' } },
        { status: 402 },
      );
    const output = unknownResponse({ messages: body.messages } as ProviderRequest).output;
    return Response.json({
      choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(output) } }],
      usage: { prompt_tokens: 2000, completion_tokens: 1000 },
    });
  }) as typeof fetch);
  for (let call = 0; call < 2; call++) {
    const ledger = new ControlLedger(),
      result = await proposeMappingWithTeacher(input.profile, {
        ...options(new ModelGateway(controlConfig(), ledger, adapter)),
        recordings,
      });
    assert.equal(result.attempts, 1);
    if (call === 0) assert.equal(ledger.settled, 1);
    else assert(result.issues.every((issue) => issue.code === 'TEACHER_BUDGET_EXHAUSTED'));
  }
  const lines = readFileSync(join(recordings.directory, readdirSync(recordings.directory)[0]), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.equal(lines.length, 2);
  assert.equal(lines[0].validation.success, true);
  assert.equal(lines[1].failureCode, 'quota_exhausted');
  assert.equal(lines[1].tokens, null);
  assert.equal(lines[1].costMicroInr, null);
  assert(!JSON.stringify(lines).includes('control-only-not-a-live-key'));
  assert.throws(() => new TeacherRecordings('docs/evidence/gf-agent/a2'), /IN_GIT/);
  const otherCheckout = mkdtempSync(join(tmpdir(), 'a2-other-checkout-control-'));
  writeFileSync(join(otherCheckout, '.git'), 'Software-control marker, not another checkout.');
  assert.throws(() => new TeacherRecordings(join(otherCheckout, 'recordings')), /IN_GIT/);
  const unavailable = new TeacherRecordings(join(mkdtempSync(join(tmpdir(), 'a2-no-record-')), 'file'));
  writeFileSync(unavailable.directory, 'Control file prevents directory creation.');
  const closed = await proposeMappingWithTeacher(input.profile, {
    ...options(new ModelGateway(controlConfig(), new ControlLedger(), adapter)),
    recordings: unavailable,
  });
  assert.equal(fetches, 2);
  assert(closed.issues.every((issue) => issue.code === 'TEACHER_RECORDING_UNAVAILABLE'));
});

test('Sarvam protocol: strict schema, nullable cache usage, no tools and masked raw credentials', async () => {
  let calls = 0;
  const adapter = new SarvamAdapter('control-only-not-a-live-key', (async (_url, init) => {
    calls++;
    const body = JSON.parse(String(init?.body));
    assert.equal(body.response_format.type, 'json_schema');
    assert.equal(body.response_format.json_schema.strict, true);
    assert.equal(body.tools, undefined);
    assert.equal(body.n, 1);
    return Response.json({
      choices: [
        {
          finish_reason: 'stop',
          message: {
            content: '{"fields":[],"echo":"control-only-not-a-live-key"}',
            reasoning_content: 'never retain',
          },
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, prompt_tokens_details: null },
    });
  }) as typeof fetch);
  const result = await adapter.propose({
    model: 'sarvam-105b',
    messages: [{ role: 'user', content: 'control' }],
    outputSchema: { type: 'object' },
    maxOutputTokens: 10,
    inputHash: hash('control'),
    sourceHashes: [],
    signal: new AbortController().signal,
    authorize: async () => {},
  });
  assert.equal(calls, 1);
  assert.equal(result.usage?.promptTokens, 1);
  assert(!JSON.stringify(result.rawResponse).includes('control-only-not-a-live-key'));
  assert(!JSON.stringify(result.rawResponse).includes('never retain'));
});
