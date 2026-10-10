// The first approved Sarvam run as one computed sequence.
//   --plan      prints the ordered calls with their size and cost at a tariff; sends nothing.
//   --dry-run   walks the same sequence through a replay gateway that cannot dispatch.
//   --live      the same walk behind an explicit gateway state; for the runtime owner only.
// Usage: tsx scripts/agent/live-proof.ts --plan|--dry-run|--live [--tariff <policy.json>]
//        [--out <dir>] [--recordings <dir>] [--learner <dir>] [--gateway-state <status.txt>]
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { userInfo } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { TABULAR_LIMITS, type RequestContext } from '../../packages/contracts/src/usp/index';
import { AppError } from '../../packages/server/src/infrastructure/errors';
import {
  extractStoreyFacts, storeyPartBatches, storeyPartsHash, storeyReplayKey, storeyRequest, STOREY_AGENT_TEMPLATE,
  type StoreyAgentResult, type StoreyPageStore, type StoreyPart,
} from '../../packages/server/src/modules/ai/document-storey-agent';
import {
  minimizeMessages, ReplayAdapter, type Message, type ProviderAdapter,
} from '../../packages/server/src/modules/model-gateway/adapter';
import {
  hash, ModelGatewayConfigSchema, type GatewayConfig,
} from '../../packages/server/src/modules/model-gateway/config';
import { ModelGateway } from '../../packages/server/src/modules/model-gateway/gateway';
import { cost, reservation } from '../../packages/server/src/modules/model-gateway/pricing';
import { TeacherRecordings } from '../../packages/server/src/modules/model-gateway/recordings';
import { mappingTeacherGatewayRuntime } from '../../packages/server/src/modules/model-gateway/runtime';
import {
  profileTabularChunk, TabularChunkMapper, type TabularChunkInput,
} from '../../packages/server/src/modules/usp/ingestion/chunk-mapping-agent';
import { layoutFingerprint } from '../../packages/server/src/modules/usp/ingestion/mapping-plan-v2';
import {
  columnProfileHash, mappingTeacherRequest, teacherReplayKey, MAPPING_TEACHER_TEMPLATE,
} from '../../packages/server/src/modules/usp/ingestion/mapping-teacher';
import { ControlLedger } from './control-runtime';
import { saveNew } from './t1-profiles';
import { developmentManifest, sourceTables, type SourceAsset } from './t1-sources';

const OUT_ROOT = 'E:/BhuAayam-data/task-data/s1';
const STOREY_STORES = 'E:/BhuAayam-data/task-data/a5/stores';
const STOREY_TRUTH = 'docs/evidence/usp/finale/GF-DATA/storey-truth';
const D8_MANIFEST = 'fixtures/usp/D8-messy-india/manifest.json';
/** The family of the A4 replay curve, so the live curve can be read beside it. */
const CURVE_FAMILY = 'mi-d10';
/** gateway.ts refuses a body over 32768 bytes, or one whose bytes + 2048 exceed inputBound.maxPromptTokens. */
const GATEWAY_BODY_BYTES = 32768;
const GATEWAY_TOKEN_ALLOWANCE = 2048;
const BYTES_PER_TOKEN_ESTIMATE = 3n;
const STOP_CODES = new Set([
  'TEACHER_BUDGET_EXHAUSTED', 'TEACHER_RATE_LIMITED', 'TEACHER_AUTH_FAILED', 'TEACHER_UNAVAILABLE',
  'TEACHER_RECORDING_UNAVAILABLE', 'TEACHER_REPLAY_UNAVAILABLE', 'TEACHER_DATA_DENIED',
]);

type BoxId = 'AG-S1' | 'AG-S2' | 'ML-D1' | 'ML-D3' | 'ML-L2' | 'AG-D1' | 'AG-E2';
export const PROPOSAL_LABEL = "lead's proposal of 10 October 2026: not approved";
/**
 * Not approved. Prices and caps are the lead's proposal to the owner; the bound, pace and labels are the
 * schema's smallest values, and the two confirmations are set only so that the arithmetic can run.
 */
export const PROPOSED_POLICY = {
  projectId: 'proposal-not-approved', policyVersion: 'lead-proposal-20261010/not-approved',
  fundingVersion: 'not-approved', gatewayExclusiveFunding: true, indiaPrivateApproved: true,
  secretReference: 'ULPIN_PROVIDER_KEY_SARVAM', model: 'sarvam-105b',
  projectCapMicroInr: '100000000', projectDailyCapMicroInr: '25000000', principalDailyCallCap: 150,
  price: {
    version: 'lead-proposal-20261010/not-approved', inputPerMillionMicroInr: '15000000',
    cachedInputPerMillionMicroInr: '5000000', outputPerMillionMicroInr: '60000000',
  },
  inputBound: { version: 'schema-minimum/not-approved', maxPromptTokens: 34816 },
  paceMs: 1500,
};

type Tariff = { policy: GatewayConfig; policyHash: string; label: string; fromFile: boolean };

/** The tariff is a whole gateway policy, read by the gateway's own schema; the default is the proposal. */
export function readTariff(path?: string): Tariff {
  const supplied = path ? JSON.parse(readFileSync(path, 'utf8')) : PROPOSED_POLICY;
  const policy = ModelGatewayConfigSchema.parse(supplied);
  const label = path ? "policy file given by the caller: approval is the owner's statement" : PROPOSAL_LABEL;
  return { policy, policyHash: hash(policy), label, fromFile: Boolean(path) };
}

type Amount = { kind: 'estimate' | 'upper_bound'; microInr: string; rupees: string; tariff: string };

/** Rupees with paise, rounded up to the next paisa so that a printed figure never understates. */
function rupees(microInr: bigint): string {
  const paise = (microInr + 9999n) / 10000n;
  return `₹${paise / 100n}.${(paise % 100n).toString().padStart(2, '0')}`;
}

function amount(microInr: bigint, kind: Amount['kind'], tariff: Tariff): Amount {
  return { kind, microInr: microInr.toString(), rupees: rupees(microInr), tariff: tariff.policy.price.version };
}

type Refusal = { input: string; reason: string; opened: boolean };
type StepInput = {
  sourceId: string; sha256: string; dataClass: 'public'; split: 'development' | 'demo';
  permission: string; permissionRecordedIn: string; sent: string;
};
type Exec =
  | { kind: 'mapping'; chunk: TabularChunkInput; file: number }
  | { kind: 'storey'; parts: StoreyPart[]; split: 'development' | 'demo'; source: StoreyPageStore['source'] };
type CallSpec = {
  id: string; purpose: string; boxes: BoxId[]; input: StepInput; exec: Exec; consumer: 'INGEST' | 'ASSIST';
  template: string; taskKind: string; scopeHash: string; replayKey: string;
  messages: Message[]; schema: Record<string, unknown>;
};
type PlannedStep = {
  step: number; id: string; provider: 'call' | 'none'; purpose: string; boxes: BoxId[]; input: StepInput;
  request: null | {
    template: string; consumer: 'INGEST' | 'ASSIST'; maxAttempts: 1; characters: number; bodyBytes: number;
    requestHash: string; replayKey: string;
    tokens: { inputEstimate: number; inputUpperBound: number; outputEstimate: number; outputUpperBound: number };
    cost: { estimate: Amount; upperBound: Amount; held: Amount };
  };
  capAdmission: null | { admitted: boolean; code: string | null };
  exec: Exec | { kind: 'replay'; of: string };
};

/** The body the gateway measures, and the same refusals it would make before any admission. */
function gatewayBody(spec: CallSpec, policy: GatewayConfig) {
  const messages = minimizeMessages(spec.messages);
  const body = { messages, outputSchema: spec.schema, model: policy.model, maxOutputTokens: policy.maxOutputTokens };
  const bytes = Buffer.byteLength(JSON.stringify(body));
  if (bytes > GATEWAY_BODY_BYTES || bytes + GATEWAY_TOKEN_ALLOWANCE > policy.inputBound.maxPromptTokens) {
    throw new AppError(413, 'MODEL_INPUT_LIMIT', 'The final minimized request exceeds its approved input bound.');
  }
  return { body, bytes };
}

function plannedRequest(spec: CallSpec, tariff: Tariff): NonNullable<PlannedStep['request']> {
  const { policy } = tariff;
  const { body, bytes } = gatewayBody(spec, policy);
  const inputEstimate = Number((BigInt(bytes) + BYTES_PER_TOKEN_ESTIMATE - 1n) / BYTES_PER_TOKEN_ESTIMATE);
  const outputEstimate = Math.ceil(policy.maxOutputTokens / 2);
  const inputUpperBound = bytes + GATEWAY_TOKEN_ALLOWANCE;
  const estimate = cost({ promptTokens: inputEstimate, completionTokens: outputEstimate }, policy.price);
  const upperBound = cost({ promptTokens: inputUpperBound, completionTokens: policy.maxOutputTokens }, policy.price);
  const requestHash = hash({
    body, sourceHashes: [spec.scopeHash], scope: spec.scopeHash, policy: policy.policyVersion,
    outputSchemaId: spec.template, taskKind: spec.taskKind,
  });
  return {
    template: spec.template, consumer: spec.consumer, maxAttempts: 1, bodyBytes: bytes, requestHash,
    characters: spec.messages.reduce((sum, message) => sum + message.content.length, 0), replayKey: spec.replayKey,
    tokens: { inputEstimate, inputUpperBound, outputEstimate, outputUpperBound: policy.maxOutputTokens },
    cost: {
      estimate: amount(estimate, 'estimate', tariff), upperBound: amount(upperBound, 'upper_bound', tariff),
      held: amount(reservation(policy), 'upper_bound', tariff),
    },
  };
}

function stableJobId(seed: string): string {
  const hex = hash(seed);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** The worker's row count per tabular chunk (tabularChunkRows in streaming-vector-worker.ts, not exported). */
function chunkRows(width: number): number {
  return Math.max(1, Math.min(TABULAR_LIMITS.chunkRows, Math.floor(TABULAR_LIMITS.columns / width)));
}

function curveChunks(asset: SourceAsset): TabularChunkInput[] {
  const table = sourceTables(asset)[0];
  const size = chunkRows(table.headers.length);
  const chunks: TabularChunkInput[] = [];
  for (let start = 0; start < table.rows.length; start += size) {
    chunks.push({
      jobId: stableJobId(asset.original.sha256), chunkIndex: chunks.length, headers: table.headers,
      rows: table.rows.slice(start, start + size) as unknown[][], sourceRef: asset.id, rowOffset: start,
      selection: { sheet: table.name, headerRows: table.headerRows },
    });
  }
  return chunks;
}

/** The profile the router hands the teacher when memory and the student answer no column. */
function teacherProfile(chunk: TabularChunkInput) {
  const { profile } = profileTabularChunk(chunk);
  const sampleShortfall = profile.columns.some(column => column.maskedSamples.length < 5);
  return { ...profile, layoutFingerprint: layoutFingerprint(profile.columns), sampleShortfall };
}

function curveInput(asset: SourceAsset, chunk: TabularChunkInput): StepInput {
  return {
    sourceId: `${asset.family}/${asset.id}`, sha256: asset.original.sha256, dataClass: 'public',
    split: 'development', permission: asset.permission.state, permissionRecordedIn: D8_MANIFEST,
    sent: `rows ${chunk.rowOffset! + 1}-${chunk.rowOffset! + chunk.rows.length}: per column the masked header, `
      + 'inferred type, value shapes and up to 5 masked samples; no row, no identifier of six digits or more',
  };
}

type CurveStep = { asset: SourceAsset; chunk: TabularChunkInput; file: number; spec: CallSpec | null };

/** Two files of one development family; the first chunk of each new header layout asks the teacher. */
function curveSteps(): CurveStep[] {
  const assets = developmentManifest().assets
    .filter(asset => asset.family === CURVE_FAMILY && asset.mediaType === 'text/csv').slice(0, 2);
  if (assets.length !== 2) throw new Error('LIVE_PROOF_CURVE_FILES_MISSING');
  return assets.flatMap((asset, file) => {
    const seen = new Set<string>();
    return curveChunks(asset).map(chunk => {
      const layout = profileTabularChunk(chunk).profile.layoutFingerprint;
      const spec = seen.has(layout) ? null : curveSpec(asset, chunk, file);
      seen.add(layout);
      return { asset, chunk, file, spec };
    });
  });
}

function curveSpec(asset: SourceAsset, chunk: TabularChunkInput, file: number): CallSpec {
  const profile = teacherProfile(chunk);
  const request = mappingTeacherRequest(profile);
  const profileHash = columnProfileHash(profile);
  return {
    id: `curve-file${file + 1}-chunk${chunk.chunkIndex + 1}`, boxes: ['AG-S1', 'AG-S2', 'ML-L2', 'AG-E2'],
    purpose: `Mapping teacher on a new header layout of ${asset.id}: one point of the two-file call curve`,
    input: curveInput(asset, chunk), exec: { kind: 'mapping', chunk, file }, consumer: 'INGEST',
    template: MAPPING_TEACHER_TEMPLATE, taskKind: 'mapping_v2', scopeHash: profileHash,
    replayKey: teacherReplayKey(profileHash), messages: request.messages, schema: request.schema,
  };
}

type StoreyRecord = {
  projectSourceId?: string; permission?: { state?: string };
  sources: { role: string; sha256: string }[];
};
type StoreySource = { sha256: string; split: 'development' | 'demo'; record: string; permission?: string };

/** Only dev/ and demo/ records are read; a document is eligible when one of them names its SHA-256. */
function storeySources(): StoreySource[] {
  const found = new Map<string, StoreySource>();
  for (const [folder, split] of [['dev', 'development'], ['demo', 'demo']] as const) {
    for (const name of readdirSync(join(STOREY_TRUTH, folder)).sort()) {
      const record = JSON.parse(readFileSync(join(STOREY_TRUTH, folder, name), 'utf8')) as StoreyRecord;
      for (const source of record.sources.filter(item => item.role === 'extraction_pdf')) {
        const permission = record.permission?.state;
        const entry = { sha256: source.sha256, split, record: `${folder}/${name}`, permission };
        if (!found.has(source.sha256)) found.set(source.sha256, entry);
      }
    }
  }
  return [...found.values()];
}

function storeySpec(source: StoreySource, store: StoreyPageStore, parts: StoreyPart[], batch: number): CallSpec {
  const request = storeyRequest(parts);
  const partsHash = storeyPartsHash(parts);
  const pages = [...new Set(parts.map(part => part.page))].join(', ');
  const scored: BoxId[] = source.split === 'development' ? ['ML-D3'] : [];
  return {
    id: `storey-${source.sha256.slice(0, 8)}-batch${batch + 1}`, consumer: 'ASSIST',
    boxes: ['AG-S1', 'AG-S2', 'ML-D1', ...scored, 'AG-D1'],
    purpose: `Storey facts with quotes from a ${source.split} RERA or sanction document (${source.record})`,
    input: {
      sourceId: source.record, sha256: source.sha256, dataClass: 'public', split: source.split,
      permission: source.permission!, permissionRecordedIn: `${STOREY_TRUTH}/${source.record}`,
      sent: `${parts.length} OCR or text-layer lines of page ${pages} that name a storey, floor, unit or height, `
        + 'each cut to 240 characters; no image, no whole page',
    },
    exec: { kind: 'storey', parts, split: source.split, source: store.source },
    template: STOREY_AGENT_TEMPLATE, taskKind: 'storey_facts_v1', scopeHash: partsHash,
    replayKey: storeyReplayKey(partsHash), messages: request.messages, schema: request.schema,
  };
}

function storeySpecs(refused: Refusal[]): CallSpec[] {
  return storeySources().flatMap(source => {
    const path = join(STOREY_STORES, `${source.sha256}.pages.json`);
    if (!source.permission) {
      refused.push({ input: source.record, reason: 'no permission state is recorded for it', opened: false });
      return [];
    }
    if (!existsSync(path)) {
      refused.push({ input: source.record, reason: 'no retained page store for this document', opened: false });
      return [];
    }
    const store = JSON.parse(readFileSync(path, 'utf8')) as StoreyPageStore;
    if (store.source.sha256 !== source.sha256) throw new Error('LIVE_PROOF_STORE_HASH_MISMATCH');
    return storeyPartBatches(store).map((parts, batch) => storeySpec(source, store, parts, batch));
  });
}

function standingRefusals(): Refusal[] {
  const heldOut = [...developmentManifest().heldOut].sort().map(family => ({
    input: `tabular family ${family}`, opened: false,
    reason: 'held-out family: its files are never opened here and never reach a teacher',
  }));
  return [...heldOut, {
    input: `${STOREY_TRUTH}/holdout/ and holdout-manifest.json`, opened: false,
    reason: 'held-out RERA projects: only dev/ and demo/ records can make a document eligible',
  }, {
    input: 'any private or restricted document, and any input without a recorded permission state', opened: false,
    reason: 'the builders return TEACHER_DATA_DENIED or T1_SOURCE_DENIED before a request exists',
  }];
}

type LedgerView = { calls: number; held: bigint; assistHeld: bigint };

/** The ledger's own order of refusals, asked with every earlier call held at its full reservation. */
function capAdmission(policy: GatewayConfig, view: LedgerView, consumer: 'INGEST' | 'ASSIST') {
  const reserve = reservation(policy);
  const cap = BigInt(policy.projectCapMicroInr);
  const assistCap = cap * BigInt(10000 - policy.ingestProtectedBps) / 10000n;
  const refuse = (code: string) => ({ admitted: false, code });
  if (view.calls >= policy.principalDailyCallCap) return refuse('MODEL_PRINCIPAL_CAP');
  if (view.held + reserve > cap) return refuse('MODEL_PROJECT_CAP');
  if (policy.projectDailyCapMicroInr && view.held + reserve > BigInt(policy.projectDailyCapMicroInr)) {
    return refuse('MODEL_DAILY_CAP');
  }
  if (consumer !== 'INGEST' && view.assistHeld + reserve > assistCap) return refuse('MODEL_CONSUMER_CAP');
  return { admitted: true, code: null };
}

function callStep(spec: CallSpec, tariff: Tariff, view: LedgerView, refused: Refusal[]): PlannedStep | null {
  let request: PlannedStep['request'];
  try {
    request = plannedRequest(spec, tariff);
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    refused.push({ input: spec.id, reason: `the gateway would refuse this request: ${error.code}`, opened: true });
    return null;
  }
  const admission = capAdmission(tariff.policy, view, spec.consumer);
  if (admission.admitted) {
    view.calls++;
    view.held += reservation(tariff.policy);
    if (spec.consumer !== 'INGEST') view.assistHeld += reservation(tariff.policy);
  }
  const { id, purpose, boxes, input, exec } = spec;
  return { step: 0, id, provider: 'call', purpose, boxes, input, request, capAdmission: admission, exec };
}

function reuseStep(curve: CurveStep): PlannedStep {
  return {
    step: 0, id: `curve-file${curve.file + 1}-chunk${curve.chunk.chunkIndex + 1}`, provider: 'none',
    purpose: 'Same header layout as an earlier chunk of this file: the verified proposal is reused, no call',
    boxes: ['ML-L2', 'AG-E2'], input: curveInput(curve.asset, curve.chunk), request: null, capAdmission: null,
    exec: { kind: 'mapping', chunk: curve.chunk, file: curve.file },
  };
}

function replayStep(first: PlannedStep): PlannedStep {
  return {
    step: 0, id: `replay-of-${first.id}`, provider: 'none', boxes: ['AG-S2'], input: first.input, request: null,
    purpose: 'The first recording replayed by its key: no admission, no dispatch, no debit', capAdmission: null,
    exec: { kind: 'replay', of: first.id },
  };
}

const estimateOf = (step: PlannedStep) => BigInt(step.request!.cost.estimate.microInr);
/** Development documents first: they are the ones a registry field can score. */
const demoLast = (step: PlannedStep) => Number(step.input.split === 'demo');

/** The first call serves the most boxes for the least estimated money; its replay follows at once. */
function orderedSteps(tariff: Tariff) {
  const refused = standingRefusals();
  const view: LedgerView = { calls: 0, held: 0n, assistHeld: 0n };
  const curve = curveSteps();
  const curveSpecs = curve.flatMap(item => (item.spec ? [item.spec] : []));
  const specs = [...curveSpecs, ...storeySpecs(refused)];
  const byWorth = [...specs].sort((left, right) => right.boxes.length - left.boxes.length
    || Number(estimateOfSpec(left, tariff) - estimateOfSpec(right, tariff)) || left.id.localeCompare(right.id));
  const first = callStep(byWorth[0], tariff, view, refused)!;
  const rest = specs.filter(spec => spec.id !== first.id);
  const calls = new Map(rest.flatMap(spec => {
    const step = callStep(spec, tariff, view, refused);
    return step ? [[spec.id, step] as const] : [];
  }));
  const curvePart = curve.flatMap(item => (item.spec ? [calls.get(item.spec.id)] : [reuseStep(item)]));
  const storeyPart = [...calls.values()].filter(step => step.exec.kind === 'storey')
    .sort((left, right) => demoLast(left) - demoLast(right)
      || Number(estimateOf(left) - estimateOf(right)) || left.id.localeCompare(right.id));
  const ordered = [first, replayStep(first), ...curvePart, ...storeyPart].filter(step => step !== undefined);
  return { steps: ordered.map((step, index) => ({ ...step, step: index + 1 })), refused };
}

function estimateOfSpec(spec: CallSpec, tariff: Tariff): bigint {
  try {
    return BigInt(plannedRequest(spec, tariff).cost.estimate.microInr);
  } catch {
    return 2n ** 62n;
  }
}

function share(part: bigint, whole: bigint): string {
  const basisPoints = whole > 0n ? (part * 10000n + whole - 1n) / whole : 0n;
  return `${basisPoints / 100n}.${(basisPoints % 100n).toString().padStart(2, '0')}%`;
}

function totalsFor(steps: PlannedStep[], tariff: Tariff) {
  const calls = steps.filter(step => step.request && step.capAdmission?.admitted);
  const sum = (pick: (step: PlannedStep) => string) => calls.reduce((total, step) => total + BigInt(pick(step)), 0n);
  const held = sum(step => step.request!.cost.held.microInr);
  const assist = calls.filter(step => step.request!.consumer === 'ASSIST');
  const { policy } = tariff;
  const cap = BigInt(policy.projectCapMicroInr);
  const assistCap = cap * BigInt(10000 - policy.ingestProtectedBps) / 10000n;
  const daily = policy.projectDailyCapMicroInr ? BigInt(policy.projectDailyCapMicroInr) : null;
  return {
    calls: calls.length,
    estimate: amount(sum(step => step.request!.cost.estimate.microInr), 'estimate', tariff),
    requestBound: amount(sum(step => step.request!.cost.upperBound.microInr), 'upper_bound', tariff),
    atMost: amount(held, 'upper_bound', tariff),
    shareOfCapsAtMost: {
      total: share(held, cap), daily: daily ? share(held, daily) : null,
      callsPerPersonPerDay: share(BigInt(calls.length), BigInt(policy.principalDailyCallCap)),
      documentAgentAllocation: share(reservation(policy) * BigInt(assist.length), assistCap),
    },
  };
}

const BOXES: BoxId[] = ['AG-S1', 'AG-S2', 'ML-D1', 'ML-D3', 'ML-L2', 'AG-D1', 'AG-E2'];

function perBox(steps: PlannedStep[], tariff: Tariff) {
  return Object.fromEntries(BOXES.map(box => {
    const { calls, estimate, atMost } = totalsFor(steps.filter(step => step.boxes.includes(box)), tariff);
    return [box, { calls, estimate, atMost }];
  }));
}

function tariffReport(tariff: Tariff) {
  const { policy } = tariff;
  const perMillion = (value: string) => amount(BigInt(value), 'upper_bound', tariff).rupees;
  const cap = (value?: string) => (value ? amount(BigInt(value), 'upper_bound', tariff).rupees : null);
  return {
    label: tariff.label, approved: false, policyHash: tariff.policyHash, priceVersion: policy.price.version,
    rupeesPerMillionTokens: {
      input: perMillion(policy.price.inputPerMillionMicroInr),
      cachedInput: perMillion(policy.price.cachedInputPerMillionMicroInr),
      output: perMillion(policy.price.outputPerMillionMicroInr),
    },
    caps: {
      total: cap(policy.projectCapMicroInr), daily: cap(policy.projectDailyCapMicroInr),
      callsPerPersonPerDay: policy.principalDailyCallCap,
      documentAgentShareOfTotal: `${(10000 - policy.ingestProtectedBps) / 100}%`,
    },
    bounds: {
      maxPromptTokens: policy.inputBound.maxPromptTokens, maxOutputTokens: policy.maxOutputTokens,
      cushionBps: policy.cushionBps, paceMs: policy.paceMs, timeoutMs: policy.timeoutMs,
    },
    heldPerCall: amount(reservation(policy), 'upper_bound', tariff),
  };
}

const TOKEN_METHOD = {
  tokenizer: 'none for sarvam-105b in this repository',
  inputEstimate: 'bytes of the body the gateway measures (messages, schema, model, output maximum) divided by 3',
  inputEstimateError: 'not measured: 3 bytes per token is an assumption until the first receipt gives the ratio',
  inputUpperBound: "body bytes + 2048, the gateway's own admission rule (one token per byte at worst)",
  outputEstimate: 'half the configured output maximum; reasoning tokens are billed as output',
  outputUpperBound: 'the configured output maximum (max_tokens in the request)',
  held: "the ledger's reservation per call: the bound's prompt maximum and the output maximum, plus the cushion",
  paise: 'every rupee figure is rounded up to the next paisa',
};

const STOP_RULES = [
  'Every call is one attempt: no repair call, no retry, never another key.',
  'The run stops at the first refusal by the gateway, the first HTTP 402 or quota answer, the first rate limit, '
    + 'the first timeout or unknown outcome, and the first answer that could not be recorded.',
  'It stops before a call when holding it at the full reservation would cross the total, daily, per-person or '
    + 'document-agent cap, counting every earlier call at its reservation.',
  'After a stop every later step asks the replay store only, ends in needs_input or teacher_unavailable when '
    + 'nothing is recorded, and its receipt says afterStop.',
  'An answer that fails validation is charged, recorded and reported as a result; it is not replayable.',
];

const CURVE_NOTE = {
  files: 'the first two CSV files of development family mi-d10, the files of the A4 replay curve',
  chunking: 'the worker rule: 16 rows per chunk, fewer for tables wider than 16 columns',
  expectedFall: 'within a file the calls fall from 1 to 0 after the first chunk of a header layout, because the '
    + 'verified proposal is reused; the student removes columns from a request only where it commits',
  acrossFiles: 'the second file asks again unless an officer-approved plan for its layout is in accepted memory or '
    + 'the student commits every column; this run approves nothing, so it promises no fall across files',
  honesty: 'the receipt reports per chunk the paid calls, replay asks, reuse, student fields, unanswered fields and '
    + 'questions as they happen; a curve that does not fall is reported as it is',
  memory: 'a new, empty memory file inside the run folder: accepted runtime memory is neither read nor written',
};

export function buildPlan(tariff: Tariff) {
  const { steps, refused } = orderedSteps(tariff);
  return {
    schemaVersion: 'live-proof-plan/1', generatedAt: new Date().toISOString(), tariff: tariffReport(tariff),
    tokenMethod: TOKEN_METHOD, steps, totals: totalsFor(steps, tariff), perBox: perBox(steps, tariff),
    stopRules: STOP_RULES, neverSent: refused, curve: CURVE_NOTE,
    ledgerAtStart: 'assumed empty: the plan does not read the runtime ledger; the live admission is the ledger',
  };
}

const printable = (steps: PlannedStep[]) => steps.map(({ exec, ...step }) => ({ ...step, kind: exec.kind }));

type Ask = { inputHash: string; replayKey: string | null };
type Drivers = {
  mode: 'dry_run' | 'live'; subject: string; outDir: string; learnerModelPath?: string;
  teacher: () => Promise<ModelGateway | undefined>; replay: () => Promise<ModelGateway | undefined>;
  asks: Ask[]; replayedKinds: Map<string, string>; recordings: TeacherRecordings | null;
};

/** A gateway whose only adapter is the replay store: it has no key, no transport and no paid ledger. */
function dryRunDrivers(
  tariff: Tariff, outDir: string, recordingsDir: string,
): Drivers & { ledger: ControlLedger } {
  const recordings = new TeacherRecordings(recordingsDir);
  const asks: Ask[] = [];
  const replayedKinds = new Map<string, string>();
  const stored = new ReplayAdapter(async key => {
    for (const kind of ['sarvam', 'control']) {
      const found = await recordings.replay(key, [kind]);
      if (found) return replayedKinds.set(key, kind) && found;
    }
    return undefined;
  });
  const adapter: ProviderAdapter = { kind: 'replay', propose: request => {
    asks.push({ inputHash: request.inputHash, replayKey: request.replayKey ?? null });
    return stored.propose(request);
  } };
  const ledger = new ControlLedger();
  const gateway = new ModelGateway(tariff.policy, ledger, adapter);
  const supply = async () => gateway;
  return { mode: 'dry_run', subject: 'local-os:s1-dry-run', outDir, teacher: supply, replay: supply, asks,
    replayedKinds, recordings: null, ledger };
}

function proofContext(subject: string): RequestContext {
  return {
    requestId: 's1-live-proof', accessViewId: 's1-live-proof', policyVersion: 'usp-local-1',
    principal: { subject, roles: ['operator'], entitlementVersion: 'local-1', mode: 'local_demo' },
  };
}

type Outcome = { state: string; code: string | null; attempts: number; replayed: boolean; detail: unknown };
type RunState = {
  mappers: Map<number, TabularChunkMapper>; stopped: string | null;
  storey: Map<string, { source: StoreyPageStore['source']; results: unknown[] }>;
};

async function runMapping(exec: Extract<Exec, { kind: 'mapping' }>, drivers: Drivers, state: RunState,
  gateway: Drivers['teacher']): Promise<Outcome> {
  if (!state.mappers.has(exec.file)) state.mappers.set(exec.file, new TabularChunkMapper());
  const draft = await state.mappers.get(exec.file)!.map(exec.chunk, {
    context: proofContext(drivers.subject), authorize: async () => {}, runtime: gateway, maxAttempts: 1,
    dataPolicy: { dataClass: 'public', split: 'development' }, memoryPath: join(drivers.outDir, 'memory.jsonl'),
    learnerModelPath: drivers.learnerModelPath,
  });
  const { layout, memoryHits, studentFields, teacherFields, unansweredFields, needsInput } = draft.metrics;
  return {
    state: draft.proposal.state, code: draft.proposal.issues[0]?.code ?? null, attempts: draft.proposal.attempts,
    replayed: draft.proposal.replayed,
    detail: { layout, memoryHits, studentFields, teacherFields, unansweredFields, needsInput,
      candidateCells: draft.dryRun.counts.candidate },
  };
}

async function runStorey(exec: Extract<Exec, { kind: 'storey' }>, drivers: Drivers, state: RunState,
  gateway: Drivers['teacher'], id: string): Promise<Outcome> {
  const result: StoreyAgentResult = await extractStoreyFacts(exec.parts, {
    context: proofContext(drivers.subject), authorize: async () => {}, runtime: gateway, maxAttempts: 1,
    dataPolicy: { dataClass: 'public', split: exec.split },
  });
  const kept = state.storey.get(exec.source.sha256) ?? { source: exec.source, results: [] };
  kept.results.push({ ...result, step: id, partIds: exec.parts.map(part => part.partId) });
  state.storey.set(exec.source.sha256, kept);
  const { state: endState, code, attempts, replayed } = result;
  const detail = { abstain: result.output?.abstain ?? null };
  return { state: endState, code: code ?? null, attempts, replayed, detail };
}

function runExec(step: PlannedStep, exec: Exec, drivers: Drivers, state: RunState, gateway: Drivers['teacher']) {
  if (exec.kind === 'mapping') return runMapping(exec, drivers, state, gateway);
  return runStorey(exec, drivers, state, gateway, step.id);
}

/** A replay of a mapping call uses a fresh mapper, so that job-local reuse cannot stand in for the store. */
function runReplay(step: PlannedStep, steps: PlannedStep[], drivers: Drivers, state: RunState) {
  const first = steps.find(item => item.exec.kind !== 'replay' && item.id === (step.exec as { of: string }).of)!;
  const fresh: RunState = { mappers: new Map(), stopped: state.stopped, storey: new Map() };
  return runExec(first, first.exec as Exec, drivers, fresh, drivers.replay);
}

async function liveNumbers(step: PlannedStep, drivers: Drivers, tariff: Tariff) {
  const empty = { httpStatus: null, inputTokens: null, outputTokens: null, actualMicroInr: null, responseHash: null };
  const recorded = step.request && drivers.recordings
    ? await drivers.recordings.replay(step.request.replayKey, ['sarvam']) : undefined;
  if (!recorded?.response.usage) return { ...empty, ledgerCallId: null };
  const { usage, httpStatus, responseHash } = recorded.response;
  return {
    httpStatus, inputTokens: usage.promptTokens, outputTokens: usage.completionTokens, responseHash,
    actualMicroInr: cost(usage, tariff.policy.price).toString(), ledgerCallId: null,
  };
}

function endState(step: PlannedStep, outcome: Outcome, drivers: Drivers): string {
  if (!outcome.replayed) return outcome.state;
  const key = step.request?.replayKey ?? [...drivers.replayedKinds.keys()].at(-1) ?? '';
  return drivers.replayedKinds.get(key) === 'control' ? 'replayed_software_control' : 'replayed_recording';
}

async function runStep(step: PlannedStep, steps: PlannedStep[], drivers: Drivers, state: RunState, tariff: Tariff) {
  const asksBefore = drivers.asks.length;
  const refusedByCap = step.capAdmission && !step.capAdmission.admitted ? step.capAdmission.code : null;
  if (refusedByCap && !state.stopped) state.stopped = `${step.id}: ${refusedByCap}`;
  const afterStop = Boolean(state.stopped);
  const gateway = afterStop ? drivers.replay : drivers.teacher;
  const outcome = step.exec.kind === 'replay'
    ? await runReplay(step, steps, drivers, state) : await runExec(step, step.exec, drivers, state, gateway);
  const asked = drivers.asks.slice(asksBefore);
  const stops = drivers.mode === 'live' && step.provider === 'call' && outcome.code && STOP_CODES.has(outcome.code);
  if (stops && !state.stopped) state.stopped = `${step.id}: ${outcome.code}`;
  return {
    step: step.step, id: step.id, mode: drivers.mode, boxes: step.boxes, afterStop,
    requestHash: step.request?.requestHash ?? null, capAdmission: step.capAdmission,
    gatewayAsks: drivers.mode === 'dry_run' ? asked.length : null,
    requestMatchesPlan: step.request && asked.length ? asked[0].inputHash === step.request.requestHash : null,
    providerCalls: drivers.mode === 'dry_run' || outcome.replayed ? 0 : outcome.attempts,
    endState: endState(step, outcome, drivers), code: outcome.code, replayed: outcome.replayed, detail: outcome.detail,
    live: await liveNumbers(step, drivers, tariff),
  };
}

/** One walk for both modes; only the drivers differ. */
async function runSequence(tariff: Tariff, drivers: Drivers) {
  const { steps } = orderedSteps(tariff);
  const state: RunState = { mappers: new Map(), stopped: null, storey: new Map() };
  const receipts = [];
  for (const step of steps) receipts.push(await runStep(step, steps, drivers, state, tariff));
  return { steps, receipts, stopped: state.stopped, storey: state.storey };
}

async function withoutNetwork<T>(action: () => Promise<T>) {
  const original = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = (async () => {
    attempts++;
    throw new Error('LIVE_PROOF_DRY_RUN_NETWORK');
  }) as typeof fetch;
  try {
    return { value: await action(), fetchAttempts: () => attempts };
  } finally {
    globalThis.fetch = original;
  }
}

/** Every request is built and asked; nothing can leave: the gateway here holds a replay adapter and no key. */
export async function dryRun(tariff: Tariff, outDir: string, recordingsDir: string) {
  const drivers = dryRunDrivers(tariff, outDir, recordingsDir);
  const walked = await withoutNetwork(() => runSequence(tariff, drivers));
  const { receipts, stopped } = walked.value;
  const providerDispatches = walked.fetchAttempts() + drivers.ledger.dispatched;
  if (providerDispatches !== 0 || drivers.ledger.reserved !== 0) throw new Error('LIVE_PROOF_DRY_RUN_DISPATCHED');
  return {
    schemaVersion: 'live-proof-receipt/1', mode: 'dry_run' as const, generatedAt: new Date().toISOString(),
    tariff: tariffReport(tariff), stopped, receipts,
    summary: {
      steps: receipts.length, gatewayAsks: drivers.asks.length, providerDispatches,
      ledgerReservations: drivers.ledger.reserved, fetchAttempts: walked.fetchAttempts(),
      requestsMatchingPlan: receipts.filter(receipt => receipt.requestMatchesPlan === true).length,
      endStates: Object.fromEntries([...new Set(receipts.map(receipt => receipt.endState))].sort()
        .map(name => [name, receipts.filter(receipt => receipt.endState === name).length])),
    },
    keyHandling: 'no key is read: the gateway is built here from the policy and a replay adapter; '
      + 'configuredGateway(), readProviderSecret() and the Sarvam adapter are never called',
  };
}

type GatewayState = {
  enabled: boolean; policyHash: string | null; providerKeyPresent: boolean;
  mappingTeacherAdapter: string; dailyCapPresent: boolean;
};

/** The five lines `demo-gateway.mjs status` prints, as facts. */
export function parseGatewayStatus(text: string): Record<string, unknown> {
  const literal = (value: string) => ({ true: true, false: false, null: null } as Record<string, unknown>)[value];
  return Object.fromEntries(text.split(/\r?\n/).filter(line => line.includes(': ')).map(line => {
    const [fact, value] = [line.slice(0, line.indexOf(': ')), line.slice(line.indexOf(': ') + 2).trim()];
    return [fact, value in { true: 1, false: 1, null: 1 } ? literal(value) : value];
  }));
}

/** Live never starts on the proposal, on a gateway that is off, or on a policy other than the one planned. */
export function assertLiveStart(state: unknown, tariff: Tariff): asserts state is GatewayState {
  const facts = (state ?? {}) as Partial<GatewayState>;
  const refuse = (reason: string): never => {
    throw new Error(`LIVE_PROOF_REFUSED: ${reason}`);
  };
  if (!tariff.fromFile) refuse("the tariff is the proposal; pass the owner's policy with --tariff");
  if (facts.enabled !== true) refuse('the gateway state does not say enabled: true');
  if (typeof facts.policyHash !== 'string' || !/^[a-f0-9]{64}$/.test(facts.policyHash)) {
    refuse('the gateway state carries no policy hash');
  }
  if (facts.policyHash !== tariff.policyHash) refuse('the enabled policy is not the policy this plan was computed for');
  if (facts.providerKeyPresent !== true || facts.dailyCapPresent !== true) refuse('key or daily cap not reported');
  if (facts.mappingTeacherAdapter !== 'sarvam') refuse('the mapping teacher adapter is not sarvam');
}

function liveDrivers(tariff: Tariff, outDir: string, learnerModelPath?: string): Drivers {
  const teacher = async () => {
    const gateway = await mappingTeacherGatewayRuntime('sarvam');
    if (gateway && hash(gateway.config) !== tariff.policyHash) throw new Error('LIVE_PROOF_POLICY_MISMATCH');
    return gateway;
  };
  const os = userInfo();
  return {
    mode: 'live', subject: `local-os:${os.uid}:${os.username}`, outDir, learnerModelPath, teacher,
    replay: () => mappingTeacherGatewayRuntime('replay'), asks: [], replayedKinds: new Map(),
    recordings: new TeacherRecordings(),
  };
}

async function runLive(tariff: Tariff, outDir: string, state: unknown, learnerModelPath?: string) {
  assertLiveStart(state, tariff);
  const { receipts, stopped, storey } = await runSequence(tariff, liveDrivers(tariff, outDir, learnerModelPath));
  for (const [sha256, kept] of storey) saveNew(join(outDir, `${sha256}.agent.json`), { ...kept, mode: 'sarvam' });
  return {
    schemaVersion: 'live-proof-receipt/1', mode: 'live' as const, generatedAt: new Date().toISOString(),
    tariff: tariffReport(tariff), gatewayState: state, stopped, receipts,
  };
}

function option(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index > 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const tariff = readTariff(option('--tariff'));
  const stamp = new Date().toISOString().replace(/[-:.]/g, '');
  const mode = ['--plan', '--dry-run', '--live'].find(flag => process.argv.includes(flag));
  if (!mode) throw new Error('Usage: live-proof.ts --plan|--dry-run|--live [--tariff <policy.json>] [--out <dir>]');
  const outDir = resolve(option('--out') ?? join(OUT_ROOT, `${mode.slice(2)}-${stamp}`));
  let document: Record<string, unknown>;
  if (mode === '--plan') {
    const plan = buildPlan(tariff);
    document = { ...plan, steps: printable(plan.steps) };
  } else if (mode === '--dry-run') {
    document = await dryRun(tariff, outDir, resolve(option('--recordings') ?? join(OUT_ROOT, 'recordings')));
  } else {
    const statePath = option('--gateway-state');
    const state = statePath ? parseGatewayStatus(readFileSync(statePath, 'utf8')) : undefined;
    document = await runLive(tariff, outDir, state, option('--learner'));
  }
  const written = join(outDir, mode === '--plan' ? 'plan.json' : 'receipt.json');
  saveNew(written, document);
  console.log(JSON.stringify({ ...document, writtenTo: written }, null, 1));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
