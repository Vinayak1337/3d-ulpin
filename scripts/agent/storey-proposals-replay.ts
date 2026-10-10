import { readdirSync, realpathSync, readFileSync, lstatSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { RequestContext } from '../../packages/contracts/src/usp';
import { AppError } from '../../packages/server/src/infrastructure/errors';
import { ModelGateway, type ModelCallLedger } from '../../packages/server/src/modules/model-gateway/gateway';
import { ModelGatewayConfigSchema, hash } from '../../packages/server/src/modules/model-gateway/config';
import { ReplayAdapter, type RetainedReplay } from '../../packages/server/src/modules/model-gateway/adapter';
import { TeacherRecordings } from '../../packages/server/src/modules/model-gateway/recordings';
import {
  extractStoreyFacts, storeyPartSelection, storeyReplayKey, type StoreyDataPolicy, type StoreyPart,
} from '../../packages/server/src/modules/ai/document-storey-agent';
import { storeyDocumentProposals, StoreyProposalPageStoreSchema, StoreyReplayRequestSchema,
  type StoreyProposalPageStore as PageStore, type StoreyReplayRequest as Request,
} from '../../packages/server/src/modules/ai/storey-document-proposals';
import { DocumentProposalsService } from '../../packages/server/src/modules/usp/ingestion/document-proposals';
import { readBoundedOcrArtifact } from '../../packages/server/src/modules/usp/ingestion/document-ocr';
import { localRequestContext } from '../../packages/server/src/modules/usp/principal';

type Dependencies = {
  recordings: TeacherRecordings;
  service: Pick<DocumentProposalsService, 'save'>;
  context: RequestContext;
  authorize?: () => Promise<void>;
};

// Schema placeholders only: replay neither reserves money nor reads the named secret.
const replayConfig = ModelGatewayConfigSchema.parse({
  projectId: 'storey-proposal-replay', policyVersion: 'storey-proposal-replay/1', fundingVersion: 'offline-no-funding',
  gatewayExclusiveFunding: true, indiaPrivateApproved: true, secretReference: 'ULPIN_PROVIDER_KEY_SARVAM',
  model: 'sarvam-105b', projectCapMicroInr: '1', principalDailyCallCap: 1,
  price: { version: 'offline-no-charge', inputPerMillionMicroInr: '1',
    cachedInputPerMillionMicroInr: '1', outputPerMillionMicroInr: '1' },
  inputBound: { version: 'offline-byte-bound/1', maxPromptTokens: 34816 },
  maxOutputTokens: 4096, timeoutMs: 45000, paceMs: 1500,
});

function replayLedger() {
  const counts = { dispatches: 0, admissions: 0 };
  const forbidden = async (): Promise<never> => {
    counts.admissions++;
    throw new Error('STOREY_REPLAY_PAID_LEDGER_FORBIDDEN');
  };
  const ledger: ModelCallLedger = {
    admissionDelay: forbidden, reserve: forbidden, releaseBeforeDispatch: forbidden,
    retainExposure: forbidden, settle: forbidden,
    dispatch: async () => {
      counts.dispatches++;
      throw new Error('STOREY_REPLAY_DISPATCH_FORBIDDEN');
    },
  };
  return { counts, ledger };
}

/** Resolve the selected recording through the existing integrity reader, filtered by its recorded adapter kind. */
async function replayWithKind(recordings: TeacherRecordings, key: string) {
  const retained = await recordings.replay(key, ['sarvam', 'control']);
  if (!retained) return null;
  const kinds: ('sarvam' | 'control')[] = [];
  for (const kind of ['sarvam', 'control'] as const) {
    const filtered = await recordings.replay(key, [kind]);
    if (filtered && hash(filtered) === hash(retained)) kinds.push(kind);
  }
  if (kinds.length !== 1) {
    throw new AppError(503, 'STOREY_RECORDING_KIND_AMBIGUOUS',
      'The selected recording cannot be attributed to exactly one recorded adapter kind.');
  }
  return { retained, kind: kinds[0] };
}

function publicPolicy(source: PageStore['source']): StoreyDataPolicy {
  const root = resolve('docs/evidence/usp/finale/GF-DATA/storey-truth');
  for (const [folder, split] of [['demo', 'demo'], ['dev', 'development']] as const) {
    for (const name of readdirSync(join(root, folder)).filter((entry) => entry.endsWith('.json'))) {
      // These are only Git's admitted public demo/development manifests, never the holdout folder.
      const record = JSON.parse(readFileSync(join(root, folder, name), 'utf8'));
      if (record.sources.some((entry: { role: string; sha256: string; bytes: number }) =>
        entry.role === 'extraction_pdf' && entry.sha256 === source.sha256 && entry.bytes === source.bytes)) {
        return { dataClass: 'public', split };
      }
    }
  }
  throw new AppError(403, 'TEACHER_DATA_DENIED', 'Select one admitted public development or demo original.');
}

function locatorsFor(parts: { partId: string; page: number }[], store: PageStore, request: Request) {
  return Object.fromEntries(parts.map((part) => {
    const page = store.pages[String(part.page)];
    const frame = request.frames[String(part.page)];
    if (!frame || frame.width !== page.width || frame.height !== page.height) {
      throw new AppError(422, 'STOREY_PAGE_FRAME', 'Supply the recorded original page frame; no rotation is guessed.');
    }
    const line = page.lines.find((entry) => entry.id === part.partId)!;
    return [part.partId, { page: part.page, frame, box: line.box ?? null, selectedRegion: null,
      declaredPrecision: line.box ? 'retained page-store line box' : 'page only; retained line box unavailable' }];
  }));
}

function assertPins(store: PageStore, request: Request) {
  if (store.source.sha256 !== request.source.sourceSha256 || store.source.bytes !== request.source.sourceBytes) {
    throw new AppError(422, 'STOREY_SOURCE_PIN', 'The page store differs from the exact original selected for saving.');
  }
  const ids = Object.values(store.pages).flatMap((page) => page.lines.map((line) => line.id));
  if (new Set(ids).size !== ids.length) {
    throw new AppError(422, 'STOREY_PART_IDS', 'Retained part IDs must be distinct.');
  }
}

/** One public original, one selected batch, one replay and at most one save through the route's existing service. */
export async function saveReplayedStoreyProposals(
  rawStore: unknown, rawRequest: unknown, dependencies: Dependencies,
) {
  const store = StoreyProposalPageStoreSchema.parse(rawStore);
  const request = StoreyReplayRequestSchema.parse(rawRequest);
  assertPins(store, request);
  boundedRecordings(dependencies.recordings.directory);
  const policy = publicPolicy(store.source);
  const selection = storeyPartSelection(store);
  const parts = selection.batches[request.batch];
  if (!parts) throw new AppError(422, 'STOREY_BATCH_REQUIRED', 'Select one existing bounded part batch.');
  const locators = locatorsFor(parts, store, request);
  const { result, kind, counts } = await replayAgent(parts, policy, dependencies);
  const adapted = storeyDocumentProposals(result, { parts, source: store.source, locators, recordingKind: kind });
  const snapshot = adapted.packet ? await dependencies.service.save(request.caseId, request.sourceId, {
    requestKey: request.requestKey, expectedCaseRevision: request.expectedCaseRevision,
    source: request.source, packet: adapted.packet,
  }) : null;
  return { state: adapted.state, code: adapted.code, snapshot, unknowns: adapted.unknowns,
    recordingKind: kind ?? null, ...counts, omitted: selection.omitted, batch: request.batch };
}

async function replayAgent(parts: StoreyPart[], policy: StoreyDataPolicy, dependencies: Dependencies) {
  const { counts, ledger } = replayLedger();
  const origins = new Map<string, 'sarvam' | 'control'>();
  const adapter = new ReplayAdapter(async (key): Promise<RetainedReplay | undefined> => {
    const recording = await replayWithKind(dependencies.recordings, key);
    if (!recording) return undefined;
    origins.set(key, recording.kind);
    return recording.retained;
  });
  const gateway = new ModelGateway(replayConfig, ledger, adapter);
  const result = await extractStoreyFacts(parts, { context: dependencies.context, gateway, dataPolicy: policy,
    authorize: dependencies.authorize ?? (async () => {}), maxAttempts: 1 });
  if (counts.dispatches || counts.admissions || gateway.adapterKind !== 'replay') {
    throw new Error('STOREY_REPLAY_ONLY_INVARIANT');
  }
  const kind = origins.get(storeyReplayKey(result.partsHash));
  if (result.state !== 'teacher_unavailable' && !kind) throw new Error('STOREY_RECORDING_KIND_REQUIRED');
  return { result, kind, counts };
}

function allowedPath(path: string) {
  const actual = realpathSync(path).replace(/\\/g, '/');
  if (/(?:^|\/)(?:runtime|holdout|heldout|evaluator)(?:\/|$)|(?:^|\/)\.env(?:\.|$)/i.test(actual)) {
    throw new Error('STOREY_REPLAY_PATH_DENIED');
  }
  return actual;
}

function boundedRecordings(directory: string) {
  const root = allowedPath(directory);
  const names = readdirSync(root).filter((name) => /^teacher-[a-f0-9-]+\.jsonl$/.test(name));
  if (names.length > 32) throw new AppError(413, 'STOREY_RECORDINGS_LIMIT', 'Select at most 32 recording files.');
  let bytes = 0;
  for (const name of names) {
    const path = join(root, name);
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('STOREY_RECORDING_FILE_REQUIRED');
    allowedPath(path);
    bytes += stat.size;
  }
  if (bytes > 16 * 1024 * 1024) {
    throw new AppError(413, 'STOREY_RECORDINGS_LIMIT', 'Select at most 32 recording files totalling at most 16 MiB.');
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 6 || args[0] !== '--pages' || args[2] !== '--request' || args[4] !== '--recordings') {
    throw new Error('Usage: storey-proposals-replay.ts --pages <store.json> --request <pins.json> --recordings <dir>');
  }
  const store = JSON.parse((await readBoundedOcrArtifact(allowedPath(args[1]), 8 * 1024 * 1024)).toString('utf8'));
  const request = JSON.parse((await readBoundedOcrArtifact(allowedPath(args[3]), 64 * 1024)).toString('utf8'));
  const recordings = new TeacherRecordings(allowedPath(args[5]));
  const receipt = await saveReplayedStoreyProposals(store, request, {
    recordings, service: new DocumentProposalsService(), context: localRequestContext('d2-storey-proposal-replay'),
  });
  console.log(JSON.stringify(receipt));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof AppError ? error.code : 'STOREY_REPLAY_COMMAND_FAILED');
    process.exitCode = 1;
  });
}
