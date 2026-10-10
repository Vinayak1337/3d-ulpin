// Runs the storey agent over retained page stores of development and demo documents only.
// Usage: tsx run-agent.ts --mode sarvam|replay --pages <store.json>... --out <dir> [--max-calls 40]
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { userInfo } from 'node:os';
import { pathToFileURL } from 'node:url';
import {
  extractStoreyFacts, storeyPartBatches, storeyPartSelection, type StoreyAgentResult, type StoreyPageStore,
} from '../../../../../packages/server/src/modules/ai/document-storey-agent';
import { mappingTeacherGatewayRuntime } from '../../../../../packages/server/src/modules/model-gateway/runtime';

const TRUTH_ROOT = resolve('docs/evidence/usp/finale/GF-DATA/storey-truth');
const DEFAULT_MAX_CALLS = 40;

function argumentValues(flag: string): string[] {
  const args = process.argv.slice(2);
  const values: string[] = [];
  const start = args.indexOf(flag) + 1;
  for (let index = start; start > 0 && index < args.length && !args[index].startsWith('--'); index++) {
    values.push(args[index]);
  }
  return values;
}

/** Only development and demo extraction PDFs are eligible; the holdout seal is never opened here. */
function eligibleSources(): Map<string, 'development' | 'demo'> {
  const eligible = new Map<string, 'development' | 'demo'>();
  for (const [folder, split] of [['dev', 'development'], ['demo', 'demo']] as const) {
    for (const name of readdirSync(join(TRUTH_ROOT, folder))) {
      const record = JSON.parse(readFileSync(join(TRUTH_ROOT, folder, name), 'utf8'));
      for (const source of record.sources.filter((item: { role: string }) => item.role === 'extraction_pdf')) {
        eligible.set(source.sha256, split);
      }
    }
  }
  return eligible;
}

const requestContext = {
  requestId: 'a5-storey-agent',
  principal: {
    subject: `local-os:${userInfo().uid}:${userInfo().username}`,
    roles: ['operator'], entitlementVersion: 'local-1', mode: 'local_demo' as const,
  },
  accessViewId: 'a5-storey-agent',
  policyVersion: 'usp-local-1',
};

type BatchResult = StoreyAgentResult & { batch: number; partIds: string[] };

async function runSource(
  store: StoreyPageStore, split: 'development' | 'demo', mode: string, budget: { left: number },
) {
  const results: BatchResult[] = [];
  for (const [batch, parts] of storeyPartBatches(store).entries()) {
    if (budget.left <= 0) break;
    const result = await extractStoreyFacts(parts, {
      context: requestContext, dataPolicy: { dataClass: 'public', split },
      runtime: () => mappingTeacherGatewayRuntime(mode), authorize: async () => {}, maxAttempts: 1,
    });
    if (!result.replayed) budget.left -= result.attempts;
    results.push({ ...result, batch, partIds: parts.map((part) => part.partId) });
    if (result.state === 'teacher_unavailable') break;
  }
  return results;
}

/** One document's agent file: its answers and, by position and code only, the lines its requests left out. */
export function agentDocument(store: StoreyPageStore, mode: string, results: BatchResult[]) {
  return { source: store.source, mode, omitted: storeyPartSelection(store).omitted, results };
}

async function main() {
  const mode = argumentValues('--mode')[0] ?? 'replay';
  const out = resolve(argumentValues('--out')[0]);
  const budget = { left: Number(argumentValues('--max-calls')[0] ?? DEFAULT_MAX_CALLS) };
  const eligible = eligibleSources();
  mkdirSync(out, { recursive: true });
  const receipt: Record<string, unknown>[] = [];
  for (const path of argumentValues('--pages')) {
    const store: StoreyPageStore = JSON.parse(readFileSync(path, 'utf8'));
    const split = eligible.get(store.source.sha256);
    if (!split) {
      receipt.push({ source: store.source.sha256, state: 'refused_not_development_or_demo' });
      continue;
    }
    const before = budget.left;
    const results = await runSource(store, split, mode, budget);
    const document = agentDocument(store, mode, results);
    writeFileSync(join(out, `${store.source.sha256}.agent.json`), JSON.stringify(document));
    const states = results.map((item) => item.state);
    const codes = results.map((item) => item.code ?? null);
    const calls = before - budget.left;
    receipt.push({ source: store.source.sha256, split, calls, states, codes, omitted: document.omitted.length });
  }
  writeFileSync(join(out, 'receipt.json'), JSON.stringify({ mode, callsLeft: budget.left, sources: receipt }, null, 1));
  console.log(JSON.stringify({ mode, callsLeft: budget.left, sources: receipt }, null, 1));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
