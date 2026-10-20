import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { userInfo } from 'node:os';
import { ModelGatewayConfigSchema, hash } from '@ulpin/server/modules/model-gateway/config';
import { answerDiagnostics, SarvamAdapter } from '@ulpin/server/modules/model-gateway/adapter';
import { issuePairs, ModelGateway, type GatewayCallEvent,
  type ModelCallLedger } from '@ulpin/server/modules/model-gateway/gateway';
import { PgModelCallLedger, type Admission, type Call, type CallDiagnostics, type CallReceipt,
  type Transact } from '@ulpin/server/modules/model-gateway/ledger';
import { reservation } from '@ulpin/server/modules/model-gateway/pricing';
import { extractStoreyFacts, type StoreyPart } from '@ulpin/server/modules/ai/document-storey-agent';
import { profileColumns } from '@ulpin/server/modules/usp/ingestion/column-profile';
import { proposeMappingWithTeacher } from '@ulpin/server/modules/usp/ingestion/mapping-teacher';

// Software-control inputs only: made-up answers from a fake transport, no key, no network, no database.
const config = ModelGatewayConfigSchema.parse({
  projectId: 'sv2-control', policyVersion: 'sv2-control/1', fundingVersion: 'control-only',
  gatewayExclusiveFunding: true, indiaPrivateApproved: true, secretReference: 'ULPIN_PROVIDER_KEY_CONTROL',
  model: 'sarvam-105b', projectCapMicroInr: '100000000', principalDailyCallCap: 20, paceMs: 1500,
  price: { version: 'sv2-control-price', inputPerMillionMicroInr: '15000000',
    cachedInputPerMillionMicroInr: '5000000', outputPerMillionMicroInr: '60000000' },
  inputBound: { version: 'control-byte-bound', maxPromptTokens: 34816 },
});
const context = { requestId: 'sv2-control', accessViewId: 'sv2-control', policyVersion: 'usp-local-1',
  principal: { subject: `local-os:${userInfo().uid}:sv2`, roles: ['operator'], entitlementVersion: 'local-1',
    mode: 'local_demo' as const } };

/** Rows as the paid ledger keeps them: output, receipt and diagnostics, so the stored row can be searched. */
class MemoryLedger implements ModelCallLedger {
  rows = new Map<string, Call & { diagnostics?: CallDiagnostics }>();
  async admissionDelay() { return 0; }
  async reserve(input: Admission) {
    const call: Call = { id: randomUUID(), input_hash: input.inputHash, scope_hash: input.scopeHash,
      config_hash: hash('sv2'), state: 'reserved', consumer: input.consumer, deadline_at: input.deadlineAt,
      reserve_micro_inr: reservation(config).toString(), actual_micro_inr: null, output: null, receipt: null,
      settlement_hash: null };
    this.rows.set(call.id, call);
    return { call, admitted: true };
  }
  async dispatch(id: string) { this.rows.get(id)!.state = 'dispatched'; }
  async releaseBeforeDispatch(id: string) { this.rows.get(id)!.state = 'released'; }
  async retainExposure(id: string) { this.rows.get(id)!.state = 'outcome_unknown'; }
  async settle(id: string, actual: bigint, output: unknown, receipt: CallReceipt) {
    return Object.assign(this.rows.get(id)!, { state: 'settled' as const, actual_micro_inr: actual.toString(),
      output: JSON.parse(JSON.stringify(output)), receipt });
  }
  async recordDiagnostics(id: string, diagnostics: CallDiagnostics) {
    this.rows.get(id)!.diagnostics ??= JSON.parse(JSON.stringify(diagnostics));
  }
}

type Answer = { finish: string; content: string; reasoning?: string; out?: number; reasoningTokens?: number };
/** One gateway on the memory ledger whose fake transport gives back the answer; nothing leaves the process. */
function gatewayAnswering(answer: Answer) {
  const ledger = new MemoryLedger();
  const fetcher = (async () => Response.json({
    choices: [{ finish_reason: answer.finish, message: { content: answer.content,
      ...(answer.reasoning ? { reasoning_content: answer.reasoning } : {}) } }],
    usage: { prompt_tokens: 600, completion_tokens: answer.out ?? 120,
      ...(answer.reasoningTokens === undefined ? {} : { completion_tokens_details:
        { reasoning_tokens: answer.reasoningTokens } }) },
  })) as typeof fetch;
  const gateway = new ModelGateway(config, ledger, new SarvamAdapter('control-only-token', fetcher));
  const events: GatewayCallEvent[] = [];
  gateway.observer = event => events.push(event);
  return { gateway, ledger, events };
}

const parts: StoreyPart[] = [{ partId: 'p1', page: 1, text: 'Tower A: G+4 floors' }];
const nothing = { value: null, expression: null, citations: [] };
const storeyAnswer = (abstainReason: string) => JSON.stringify({ storeyCount: nothing, basementCount: nothing,
  floorExpressions: [], labels: [], heights: [], unitCounts: [], conflicts: [], abstain: true, abstainReason });
const askStorey = (gateway: ModelGateway) => extractStoreyFacts(parts, { context, gateway, maxAttempts: 1,
  authorize: async () => {}, dataPolicy: { dataClass: 'public', split: 'development' } });
const onlyRow = (ledger: MemoryLedger) => {
  assert.equal(ledger.rows.size, 1);
  return [...ledger.rows.values()][0];
};

test('adapter: finish reason, lengths and reasoning tokens are read; text and odd finish reasons are not', () => {
  const choice = { finish_reason: 'length', message: { content: 'abcd', reasoning_content: 'thinking' } };
  assert.deepEqual(answerDiagnostics(choice, { completion_tokens_details: { reasoning_tokens: 7 } }),
    { finishReason: 'length', contentChars: 4, reasoningChars: 8, reasoningTokens: 7 });
  assert.deepEqual(answerDiagnostics({ finish_reason: 'stop because of the text', message: { reasoning: 'ab' } }, {}),
    { finishReason: null, contentChars: 0, reasoningChars: 2, reasoningTokens: null });
  assert.deepEqual(answerDiagnostics(undefined, { completion_tokens_details: { reasoning_tokens: -1 } }),
    { finishReason: null, contentChars: 0, reasoningChars: 0, reasoningTokens: null });
});

test('truncated storey answer: length, its content length and reasoning tokens; not validated', async () => {
  const content = '{"storeyCount":{"value":4,"expression":"Quokka partial';
  const { gateway, ledger, events } = gatewayAnswering({ finish: 'length', content, out: 2048,
    reasoningTokens: 1900 });
  const result = await askStorey(gateway);
  assert.equal(result.code, 'TEACHER_INVALID_OUTPUT');
  const row = onlyRow(ledger);
  assert.equal(row.receipt?.semanticError, 'truncated_output');
  assert.deepEqual(row.diagnostics, { finishReason: 'length', contentChars: content.length, reasoningChars: 0,
    reasoningTokens: 1900, validationIssues: null });
  assert(!JSON.stringify(row).includes('Quokka'));
  const settled = events.find(event => event.kind === 'settled');
  assert.deepEqual([events[0].kind, settled?.callId, settled?.kind === 'settled' && settled.receipt.outputTokens],
    ['dispatched', row.id, 2048]);
});

test('valid storey answer: stop, its content length and no issues', async () => {
  const content = storeyAnswer('Quokka sees no storey line');
  const { gateway, ledger, events } = gatewayAnswering({ finish: 'stop', content });
  assert.equal((await askStorey(gateway)).state, 'abstained');
  const row = onlyRow(ledger);
  assert.deepEqual(row.diagnostics, { finishReason: 'stop', contentChars: content.length, reasoningChars: 0,
    reasoningTokens: null, validationIssues: [] });
  const settled = events.at(-1);
  assert(settled?.kind === 'settled');
  assert.deepEqual([settled.receipt.inputTokens, settled.receipt.actualMicroInr, settled.priceVersion],
    [600, '16200', 'sv2-control-price']);
  assert.deepEqual(settled.diagnostics, row.diagnostics);
});

test('separate reasoning: only its length is kept, never its text', async () => {
  const reasoning = 'Wombat thinking about every floor of the tower';
  const content = storeyAnswer('Quokka sees no storey line');
  const { gateway, ledger, events } = gatewayAnswering({ finish: 'stop', content, reasoning, reasoningTokens: 30 });
  await askStorey(gateway);
  const row = onlyRow(ledger);
  assert.deepEqual(row.diagnostics, { finishReason: 'stop', contentChars: content.length,
    reasoningChars: reasoning.length, reasoningTokens: 30, validationIssues: [] });
  for (const kept of [row, events]) assert(!JSON.stringify(kept).includes('Wombat'));
});

test('invalid mapping plan with two issues: {path, code} pairs only, no column name and no answer text', async () => {
  const rows = [{ 'Owner Secretname': 'Quokka Lane', 'Plot area': '120' }];
  const profile = profileColumns(rows, Object.keys(rows[0]).map(name => ({ name })), 'tabular');
  const field = { sourceField: 'column_a', target: 'unknown', operation: { kind: 'copy' }, confidence: 'none',
    rationale: 'Quokka rationale without any number' };
  const content = JSON.stringify({ fields: [field, field] });
  const { gateway, ledger } = gatewayAnswering({ finish: 'stop', content });
  const result = await proposeMappingWithTeacher(profile, { context, gateway, maxAttempts: 1,
    authorize: async () => {}, dataPolicy: { dataClass: 'public', split: 'development' } });
  assert.equal(result.state, 'needs_input');
  const row = onlyRow(ledger);
  assert.deepEqual(row.diagnostics?.validationIssues, [
    { path: 'fields.1', code: 'MAPPING_SOURCE_FIELD_DUPLICATE' }, { path: '', code: 'MAPPING_SOURCE_FIELD_UNMAPPED' },
  ]);
  assert.equal(row.diagnostics?.contentChars, content.length);
  const stored = JSON.stringify(row.diagnostics);
  for (const text of ['Quokka', 'Secretname', 'Plot area', 'rationale']) assert(!stored.includes(text), text);
});

test('issue pairs: at most 20, a key the answer could have written becomes *, a message is never kept', () => {
  const many = Array.from({ length: 30 }, (_, index) => ({ path: ['fields', index, 'target'], code: 'invalid_value',
    message: 'Quokka' }));
  const pairs = issuePairs(many);
  assert.equal(pairs.length, 20);
  assert.deepEqual(pairs[3], { path: 'fields.3.target', code: 'invalid_value' });
  assert.deepEqual(issuePairs([{ path: ['Quokka Lane', 0], code: 'quoted "text"' }]),
    [{ path: '*.0', code: 'unrecognized' }]);
});

test('ledger: diagnostics are one additive write beside the receipt, checked before it is sent', async () => {
  const sent: { sql: string; values: unknown[] }[] = [];
  const transact = (async action => action({ query: async (sql: string, values: unknown[]) => {
    sent.push({ sql: sql.replace(/\s+/g, ' ').trim(), values });
    return { rows: [] };
  } } as any)) as Transact;
  const ledger = new PgModelCallLedger(transact, config, hash('control-only-token'), 'sarvam');
  const diagnostics: CallDiagnostics = { finishReason: 'length', contentChars: 10, reasoningChars: 0,
    reasoningTokens: null, validationIssues: null };
  await ledger.recordDiagnostics('8a8f8d4e-8f0e-4b7a-9d55-3f5d1f0c2a11', diagnostics);
  assert.deepEqual(sent.map(item => item.sql), ['UPDATE usp_model_calls SET diagnostics=$2 '
    + 'WHERE id=$1 AND config_hash=$3 AND diagnostics IS NULL']);
  assert.deepEqual(sent[0].values.slice(0, 2), ['8a8f8d4e-8f0e-4b7a-9d55-3f5d1f0c2a11', diagnostics]);
  await assert.rejects(ledger.recordDiagnostics('8a8f8d4e-8f0e-4b7a-9d55-3f5d1f0c2a11',
    { ...diagnostics, validationIssues: [{ path: 'Quokka Lane', code: 'x' }] }));
  assert.equal(sent.length, 1);
});
