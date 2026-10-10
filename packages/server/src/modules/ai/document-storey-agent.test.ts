import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { controlConfig, ControlLedger, requestContext } from '../../../../../scripts/agent/control-runtime';
import { ModelGateway } from '../model-gateway/gateway';
import { hash } from '../model-gateway/config';
import { ControlAdapter, ReplayAdapter, type ProviderRequest } from '../model-gateway/adapter';
import { TeacherRecordings } from '../model-gateway/recordings';
import {
  extractStoreyFacts, heightMetres, storeyPartBatches, storeyRequest, validateStoreyOutput,
  type StoreyAgentOptions, type StoreyPart, type StoreyPageStore,
} from './document-storey-agent';

const PARTS: StoreyPart[] = [
  { partId: 'p1-l0', page: 1, text: 'T-3 G+41' },
  { partId: 'p1-l1', page: 1, text: 'No. of Apartments : 81' },
  { partId: 'p2-l0', page: 2, text: 'G + 42' },
];
const NO_CITATIONS = { value: null, expression: null, citations: [] };

function answer(overrides: Record<string, unknown> = {}) {
  return {
    storeyCount: NO_CITATIONS,
    basementCount: NO_CITATIONS,
    floorExpressions: [
      { expression: 'G+41', scope: 'T-3', citations: [{ partId: 'p1-l0', quote: 'G+41' }] },
      { expression: 'G+42', scope: null, citations: [{ partId: 'p2-l0', quote: 'G + 42' }] },
    ],
    labels: [],
    heights: [],
    unitCounts: [{ value: 81, scope: null, citations: [{ partId: 'p1-l1', quote: 'Apartments : 81' }] }],
    conflicts: [{ field: 'storeyCount', expressions: ['G+41', 'G+42'], citations: [
      { partId: 'p1-l0', quote: 'G+41' }, { partId: 'p2-l0', quote: 'G + 42' },
    ] }],
    abstain: false,
    abstainReason: null,
    ...overrides,
  };
}

function gatewayReturning(output: unknown) {
  const ledger = new ControlLedger();
  const adapter = new ControlAdapter(async (request: ProviderRequest) => ({
    output, responseHash: hash(output), httpStatus: 200, usage: { promptTokens: 900, completionTokens: 300 },
    rawResponse: { output, seen: request.messages.length },
  }));
  return { ledger, gateway: new ModelGateway(controlConfig(), ledger, adapter) };
}

const optionsFor = (gateway: ModelGateway, recordings?: TeacherRecordings): StoreyAgentOptions => ({
  context: requestContext, gateway, recordings, authorize: async () => {},
  dataPolicy: { dataClass: 'public', split: 'development' }, maxAttempts: 1,
});

test('request: closed schema whose citations can only name parts that were sent', () => {
  const request = storeyRequest(PARTS);
  const text = JSON.stringify(request.schema);
  assert(text.includes('"p1-l0"') && text.includes('"p2-l0"'));
  assert(!text.includes('"p9-l9"'));
  assert.equal(JSON.parse(request.messages[1].content).parts.length, 3);
});

test('validation: a citation to an unsent part, an extra key or a negative height is rejected', () => {
  assert(validateStoreyOutput(answer(), PARTS).success);
  const foreign = answer({ labels: [{ label: 'X', kind: 'ground', citations: [{ partId: 'p9-l9', quote: 'X' }] }] });
  assert(!validateStoreyOutput(foreign, PARTS).success);
  assert(!validateStoreyOutput({ ...answer(), invented: 1 }, PARTS).success);
  const negative = answer({ heights: [{ statedValue: -3, statedUnit: 'm', citations: [] }] });
  assert(!validateStoreyOutput(negative, PARTS).success);
});

test('gateway: a candidate keeps both Tower 3 expressions and is recorded for replay', async () => {
  const recordings = new TeacherRecordings(mkdtempSync(join(tmpdir(), 'a5-storey-')));
  const { ledger, gateway } = gatewayReturning(answer());
  const result = await extractStoreyFacts(PARTS, optionsFor(gateway, recordings));
  assert.equal(result.state, 'candidate');
  assert.deepEqual(result.output?.floorExpressions.map((item) => item.expression), ['G+41', 'G+42']);
  assert.equal(ledger.settled, 1);
  const replayAdapter = new ReplayAdapter((key) => recordings.replay(key));
  const replayGateway = new ModelGateway(controlConfig(), new ControlLedger(), replayAdapter);
  const replayed = await extractStoreyFacts(PARTS, optionsFor(replayGateway));
  assert.equal(replayed.replayed, true);
  assert.deepEqual(replayed.output, result.output);
});

test('gateway: abstention and a budget failure are reported, not turned into facts', async () => {
  const abstain = answer({ floorExpressions: [], unitCounts: [], conflicts: [], abstain: true, abstainReason: 'none' });
  const { gateway } = gatewayReturning(abstain);
  assert.equal((await extractStoreyFacts(PARTS, optionsFor(gateway))).state, 'abstained');
  const denied = new ControlLedger();
  denied.denyCode = 'MODEL_PROJECT_CAP';
  const unused = new ControlAdapter(async () => {
    throw new Error('unused');
  });
  const capped = new ModelGateway(controlConfig(), denied, unused);
  const result = await extractStoreyFacts(PARTS, optionsFor(capped));
  const expected = ['teacher_unavailable', 'TEACHER_BUDGET_EXHAUSTED', null];
  assert.deepEqual([result.state, result.code, result.output], expected);
});

test('policy: held-out and private documents never reach the gateway', async () => {
  const { ledger, gateway } = gatewayReturning(answer());
  for (const policy of [{ dataClass: 'public', split: 'held_out' }, { dataClass: 'private', split: 'development' }]) {
    const result = await extractStoreyFacts(PARTS, { ...optionsFor(gateway), dataPolicy: policy as never });
    assert.equal(result.code, 'TEACHER_DATA_DENIED');
  }
  assert.equal(ledger.reserved, 0);
});

test('no configured gateway fails closed as teacher_unavailable', async () => {
  const result = await extractStoreyFacts(PARTS, { ...optionsFor(undefined as never), runtime: async () => undefined });
  assert.deepEqual([result.state, result.code], ['teacher_unavailable', 'TEACHER_UNAVAILABLE']);
});

test('batches: only storey-related lines are sent and each call stays under the prompt bound', () => {
  const lines = Array.from({ length: 400 }, (_, index) => ({
    id: `p1-l${index}`, text: `GROUND FLOOR plan ${index} `.repeat(4),
  }));
  const store: StoreyPageStore = { source: { sha256: 'a'.repeat(64) }, pages: {
    '1': { lines: [...lines, { id: 'p1-noise', text: 'SCALE 1:100' }] },
  } };
  const batches = storeyPartBatches(store);
  assert(batches.length > 1);
  assert(batches.flat().every((part) => part.partId !== 'p1-noise'));
  for (const batch of batches) assert(batch.reduce((sum, part) => sum + part.text.length, 0) <= 14000);
});

test('heights: units are converted by code and a missing unit stays unknown', () => {
  assert.equal(heightMetres(10, 'ft'), 3.048);
  assert.equal(heightMetres(3000, 'mm'), 3);
  assert.equal(heightMetres(3.2, 'unit_unknown'), null);
});
