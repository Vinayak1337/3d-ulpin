import test from 'node:test';
import fixtures from './mapping-teacher.fixtures.json';
import assert from 'node:assert/strict';
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
  mappingTeacherRequest,
  executeTeacherMappingDryRun,
  columnProfileHash,
  teacherReplayKey,
  validateTeacherOutput,
  mappingContextFromColumnProfile,
} from '../../packages/server/src/modules/usp/ingestion/mapping-teacher';
import {
  ingestTeacherLabels,
  DEVELOPMENT_TEACHER_METHOD,
} from '../../packages/server/src/modules/usp/ingestion/teacher-labels';
import { validateMappingPlanV2 } from '../../packages/server/src/modules/usp/ingestion/mapping-plan-v2';
import { ModelGateway } from '../../packages/server/src/modules/model-gateway/gateway';
import { hash } from '../../packages/server/src/modules/model-gateway/config';
import {
  ControlAdapter,
  ReplayAdapter,
  SarvamAdapter,
  classifyProviderFailure,
  type ProviderRequest,
  type ProviderResult,
} from '../../packages/server/src/modules/model-gateway/adapter';
import { TeacherRecordings } from '../../packages/server/src/modules/model-gateway/recordings';
import { PgModelCallLedger, type Transact } from '../../packages/server/src/modules/model-gateway/ledger';

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
    profile.columns[0].maskedSamples,
    'Already masked shape samples must stay idempotent.',
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
  const plan = { ...result.plan, method: DEVELOPMENT_TEACHER_METHOD },
    labels = join(directory, 'teacher-labels.jsonl');
  writeFileSync(
    labels,
    [
      { profileHash, plan, method: DEVELOPMENT_TEACHER_METHOD },
      {
        profileHash,
        plan: {
          ...plan,
          fields: plan.fields.map((f) => ({ ...f, operation: { kind: 'copy', epsg: 'EPSG:4326' } })),
        },
        method: DEVELOPMENT_TEACHER_METHOD,
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
      (e) => e.labelKind === 'pseudo_label' && e.verified === true && e.method === DEVELOPMENT_TEACHER_METHOD,
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
