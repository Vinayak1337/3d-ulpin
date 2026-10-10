import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { controlConfig, ControlLedger, requestContext } from '../../../../../scripts/agent/control-runtime';
import { ModelGateway } from '../model-gateway/gateway';
import { hash } from '../model-gateway/config';
import { ControlAdapter, minimizeMessages, ReplayAdapter, type ProviderRequest } from '../model-gateway/adapter';
import { TeacherRecordings } from '../model-gateway/recordings';
import {
  extractStoreyFacts, heightMetres, storeyPartBatches, storeyPartSelection, storeyRequest, validateStoreyOutput,
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
  assert.equal(result.gatewayRefusal, undefined);
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
  assert.deepEqual(result.gatewayRefusal, { code: 'MODEL_PROJECT_CAP', retryable: false });
});

test('policy: held-out and private documents never reach the gateway', async () => {
  const { ledger, gateway } = gatewayReturning(answer());
  for (const policy of [{ dataClass: 'public', split: 'held_out' }, { dataClass: 'private', split: 'development' }]) {
    const result = await extractStoreyFacts(PARTS, { ...optionsFor(gateway), dataPolicy: policy as never });
    assert.equal(result.code, 'TEACHER_DATA_DENIED');
    assert.equal(result.gatewayRefusal, undefined);
  }
  assert.equal(ledger.reserved, 0);
});

test('no configured gateway fails closed as teacher_unavailable', async () => {
  const result = await extractStoreyFacts(PARTS, { ...optionsFor(undefined as never), runtime: async () => undefined });
  assert.deepEqual([result.state, result.code], ['teacher_unavailable', 'TEACHER_UNAVAILABLE']);
  assert.equal(result.gatewayRefusal, undefined);
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

test('selection: a line the minimizer refuses is left out, named, and cannot be cited', async () => {
  const lines = ['GROUND FLOOR PLAN', '[TOTAL TYPICAL FLOOR AREA', 'T-3 G+41'].map((text, index) => ({
    id: `p1-l${index}`, text,
  }));
  const store: StoreyPageStore = { source: { sha256: 'b'.repeat(64) }, pages: { '1': { lines } } };
  const asRead = lines.map((line) => ({ partId: line.id, page: 1, text: line.text }));
  assert.throws(() => minimizeMessages(storeyRequest(asRead).messages), { code: 'MODEL_PROMPT_PRIVACY' });
  const selection = storeyPartSelection(store);
  assert.deepEqual(selection.omitted, [{ partId: 'p1-l1', page: 1, line: 1, code: 'MODEL_PROMPT_PRIVACY' }]);
  const parts = selection.batches.flat();
  assert.deepEqual(parts.map((part) => part.partId), ['p1-l0', 'p1-l2']);
  assert.doesNotThrow(() => minimizeMessages(storeyRequest(parts).messages));
  const citesOmitted = answer({ floorExpressions: [], unitCounts: [], conflicts: [], labels: [
    { label: 'TYPICAL FLOOR', kind: 'typical', citations: [{ partId: 'p1-l1', quote: 'TYPICAL FLOOR' }] },
  ] });
  assert(!validateStoreyOutput(citesOmitted, parts).success);
  const { gateway } = gatewayReturning(citesOmitted);
  const result = await extractStoreyFacts(parts, optionsFor(gateway));
  assert.deepEqual([result.state, result.code, result.output], ['teacher_unavailable', 'TEACHER_INVALID_OUTPUT', null]);
});

test('selection: a line the check on a whole message refuses is left out and named; the rest is sent', async () => {
  const kept = ['GROUND FLOOR PLAN', 'T-3 G+41'];
  const refused = ['FLOOR DATA: G+4', 'tower image_url 2', 'BLOCK A base64 FLOOR 3'];
  const lines = [kept[0], ...refused, kept[1]].map((text, index) => ({ id: `p1-l${index}`, text }));
  const store: StoreyPageStore = { source: { sha256: 'd'.repeat(64) }, pages: { '1': { lines } } };
  for (const [index, text] of refused.entries()) {
    const alone = [{ partId: `p1-l${index + 1}`, page: 1, text }];
    assert.throws(() => minimizeMessages(storeyRequest(alone).messages), { code: 'MODEL_PROMPT_PRIVACY' });
  }
  const selection = storeyPartSelection(store);
  assert.deepEqual(selection.omitted, [1, 2, 3].map((line) => (
    { partId: `p1-l${line}`, page: 1, line, code: 'MODEL_MESSAGE_CHECK' })));
  const parts = selection.batches.flat();
  assert.deepEqual(parts.map((part) => part.text), kept);

  let sent = '';
  const adapter = new ControlAdapter(async (request: ProviderRequest) => {
    sent = request.messages[1].content;
    const output = answer({ floorExpressions: [], unitCounts: [], conflicts: [], abstain: true });
    return { output, responseHash: hash(output), httpStatus: 200, usage: { promptTokens: 9, completionTokens: 3 } };
  });
  const gateway = new ModelGateway(controlConfig(), new ControlLedger(), adapter);
  const result = await extractStoreyFacts(parts, optionsFor(gateway));
  assert.equal(result.state, 'abstained');
  assert.deepEqual(JSON.parse(sent).parts.map((part: StoreyPart) => part.partId), ['p1-l0', 'p1-l4']);

  // With no such line the selection, and so the request, is what it was.
  const plain = { ...store, pages: { '1': { lines: lines.filter((line) => kept.includes(line.text)) } } };
  const same = storeyPartSelection(plain);
  assert.deepEqual([same.omitted, same.batches.flat().map((part) => part.text)], [[], kept]);
  assert.equal(storeyRequest(same.batches[0]).messages[1].content, JSON.stringify({ parts: [
    { partId: 'p1-l0', page: 1, text: kept[0] }, { partId: 'p1-l4', page: 1, text: kept[1] },
  ] }));
});

test('selection: a numbered unit in a contact line selects nothing; a stated unit count does', () => {
  const lines = [
    'Unit.No.12, Example Chambers, Sector-9, Sampleville O :- 011-5550100',
    'UNIT=36',
    'TOTAL NO. OF UNITS 36',
    'UNIT NO. 7 SECOND FLOOR',
    'NORTH',
  ].map((text, index) => ({ id: `p1-l${index}`, text }));
  const selection = storeyPartSelection({ source: { sha256: 'c'.repeat(64) }, pages: { '1': { lines } } });
  assert.deepEqual(selection.batches.flat().map((part) => part.partId), ['p1-l1', 'p1-l2', 'p1-l3']);
  // Left out by the selection, not by privacy: the minimizer would accept the contact line.
  assert.deepEqual(selection.omitted, [{ partId: 'p1-l0', page: 1, line: 0, code: 'NOT_SELECTED_UNIT_NUMBER' }]);
  assert.doesNotThrow(() => minimizeMessages([{ role: 'user', content: lines[0].text }]));
});

test('heights: units are converted by code and a missing unit stays unknown', () => {
  assert.equal(heightMetres(10, 'ft'), 3.048);
  assert.equal(heightMetres(3000, 'mm'), 3);
  assert.equal(heightMetres(3.2, 'unit_unknown'), null);
});
