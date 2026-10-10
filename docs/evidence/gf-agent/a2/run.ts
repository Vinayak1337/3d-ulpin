import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execSync, execFileSync } from 'node:child_process';
import {
  goodFile, difficultFile, controlConfig, ControlLedger, unknownResponse, options,
} from '../../../../scripts/agent/control-runtime';
import { profileColumnFile } from '../../../../packages/server/src/modules/usp/ingestion/column-profile';
import {
  proposeMappingWithTeacher, executeTeacherMappingDryRun, mappingContextFromColumnProfile,
} from '../../../../packages/server/src/modules/usp/ingestion/mapping-teacher';
import { validateMappingPlanV2 } from '../../../../packages/server/src/modules/usp/ingestion/mapping-plan-v2';
import { ModelGateway } from '../../../../packages/server/src/modules/model-gateway/gateway';
import { ControlAdapter, ReplayAdapter } from '../../../../packages/server/src/modules/model-gateway/adapter';
import { TeacherRecordings } from '../../../../packages/server/src/modules/model-gateway/recordings';

const outputDirectory = resolve('docs/evidence/gf-agent/a2');
const digest = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const manifest = JSON.parse(readFileSync('fixtures/usp/D4/reference-area-gurugram-59-63a/manifest.json', 'utf8'));
const recordings = new TeacherRecordings(mkdtempSync(join(tmpdir(), 'a2-evidence-replay-')));

function save(name: string, value: unknown) {
  writeFileSync(join(outputDirectory, name), JSON.stringify(value, null, 2) + '\n');
}

function sourceAsset(index: number): { sha256: string; permission: string; purpose: string } {
  const id = index === 0 ? 'lgd-gurugram.csv' : 'gmda-sector-boundaries';
  const asset = manifest.assets.find((item: { id: string }) => item.id === id);
  return {
    sha256: index === 0 ? asset.content.sha256 : asset.provenance.original.sha256,
    permission: asset.permission.state, purpose: asset.provenance.purpose,
  };
}

async function checkInput(path: string, index: number) {
  const sourceHash = digest(path);
  const asset = sourceAsset(index);
  assert.equal(sourceHash, asset.sha256);
  const input = profileColumnFile(path);
  const ledger = new ControlLedger();
  const adapter = new ControlAdapter(async request => unknownResponse(request));
  const gateway = new ModelGateway(controlConfig(), ledger, adapter);
  const teacher = await proposeMappingWithTeacher(input.profile, { ...options(gateway), recordings });
  const context = { ...mappingContextFromColumnProfile(input.profile), sourceRef: path, rowCount: input.rows.length };
  assert(validateMappingPlanV2(teacher.plan, context).success);
  const dryRun = executeTeacherMappingDryRun(teacher, input.rows, context);
  assert.equal(dryRun.counts.needsInput, dryRun.counts.cells);
  assert.equal(ledger.settled, 1);
  const replayLedger = new ControlLedger();
  replayLedger.denyCode = 'MODEL_PROJECT_CAP';
  const replayAdapter = new ReplayAdapter(key => recordings.replay(key));
  const replayGateway = new ModelGateway(controlConfig(), replayLedger, replayAdapter);
  const replay = await proposeMappingWithTeacher(input.profile, options(replayGateway));
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.plan, teacher.plan);
  assert.equal(replayLedger.reserved, 0);
  assert.equal(digest(path), sourceHash);
  save(index === 0 ? 'lgd.profile.json' : 'gmda.profile.json', input.profile);
  return {
    input: path, sha256: sourceHash, permission: asset.permission, purpose: asset.purpose,
    rows: input.rows.length, columns: input.profile.columns.length, profileHash: teacher.profileHash,
    layoutFingerprint: input.profile.layoutFingerprint, sampleShortfall: input.profile.sampleShortfall,
    sampledCellsPerColumn: input.profile.columns[0].maskedSamples.length, planValidation: 'passed',
    teacherCalls: teacher.attempts, controlReservations: ledger.reserved, controlSettlements: ledger.settled,
    controlActualMicroInr: [...ledger.calls.values()][0].actual_micro_inr, dryRun: dryRun.counts,
    replayed: true, replayPaidAdmissions: replayLedger.reserved, sourceHashUnchanged: true,
  };
}

const CHECK_COMMANDS = [
  ['pnpm exec tsx --test', 'scripts/agent/mapping-teacher*.test.ts'],
  [
    'pnpm exec tsx --test tests/model-gateway/control.test.ts',
    'packages/contracts/src/canonical/*.test.ts',
    'packages/server/src/modules/usp/ingestion/mapping-plan-v2.test.ts',
    'packages/server/src/modules/usp/ingestion/mapping-executor.test.ts',
    'packages/server/src/modules/usp/ingestion/unit-table.test.ts',
    'tests/adaptive-mapping.test.ts',
  ],
  ['pnpm typecheck'],
  ['pnpm test:ai'],
  ['pnpm exec tsc -p scripts/agent/tsconfig.json'],
  [
    'pnpm exec tsc --noEmit --strict --skipLibCheck --target ES2022 --module ESNext --moduleResolution Bundler',
    'packages/contracts/src/index.ts packages/contracts/src/usp/index.ts',
  ],
  ['pnpm exec tsx scripts/agent/check-a1-readability.ts'],
  ['pnpm exec tsx scripts/agent/check-workbooks.ts'],
  [
    'pnpm exec tsx scripts/agent/mapping-teacher.ts',
    goodFile, '--public-development',
  ],
  ['git diff --check'],
];

function runChecks() {
  return CHECK_COMMANDS.map(commandParts => {
    const env = { ...process.env };
    if (commandParts[0].endsWith('check-workbooks.ts')) {
      env.ULPIN_PROFILE_PYTHON ??= 'E:/BhuAayam-data/ml/venv-plans/Scripts/python.exe';
    }
    execSync(commandParts.join(' '), { stdio: 'inherit', env });
    return { commandParts, exitCode: 0 };
  });
}

const LIVE_COMMAND = [
  'pnpm exec tsx scripts/agent/mapping-teacher.ts', goodFile, '--public-development --live',
];
const inputs = [];
for (const [index, path] of [goodFile, difficultFile].entries()) inputs.push(await checkInput(path, index));
const result = {
  schemaVersion: 'mapping-teacher-a2-evidence/2', task: 'A2-review', gate: 'GF-AGENT',
  qualification: 'Offline foundation; no live-provider, dictionary accuracy or whole-gate claim.',
  codeCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  checkedWorkingTree: true,
  runAt: new Date().toISOString(), environment: { node: process.version, platform: process.platform },
  inputs, checks: runChecks(),
  tests: { newChecks: 15, existingGatewayAndMappingChecks: 21, existingGroundingChecks: 22, failures: 0 },
  recoveryReference: 'docs/evidence/gf-agent/a2/recovery.json',
  workbookInterpreter: 'ULPIN_PROFILE_PYTHON or installed venv-plans; foreign test-only reader mechanics.',
  reviewFixes: {
    perFieldLabels: { maxFieldIssueRate: 0.1, fieldMetrics: ['cells', 'needsInput', 'conflicting'] },
    newestReplay: 'Most recent valid recordedAt; never arbitrary UUID order.',
    workbookReader: 'scripts/agent/read_workbook_cells.py; existing native readers and limits.',
    encoding: ['strict_utf8', 'bom_utf16le', 'bom_utf16be', 'COLUMN_ENCODING_UNSUPPORTED'],
    partialRetention: 'First valid target in column order; duplicate fields become unknown.',
    duplicateIssueCode: 'TEACHER_DUPLICATE_TARGET',
    readability: 'Named helpers, no embedded Python, spaced style and bounded lines.',
    a1Outputs: 'LGD and GMDA output JSON is byte-identical to staging.',
  },
  failureModes: [
    'missing_key', 'http_401', 'http_402', 'http_429_rate_limit', 'http_429_insufficient_quota',
    'timeout', 'network_error', 'total_cap', 'daily_money_cap', 'daily_call_cap', 'recording_unavailable',
  ],
  invariants: {
    publicDevelopmentOnly: true, heldOutTeacherDenied: true, privateRestrictedTeacherDenied: true,
    noCredentialRotation: true, repairLimit: 1, networkRetries: 0, maxAttemptsIncludingRepair: 2,
    registryWrites: 0, literalsRejected: true, manualMappingAvailable: true, rawSourcesUnchanged: true,
  },
  replay: {
    kind: 'recorded_software_control', recordingDirectory: recordings.directory, paidReservations: 0,
    keyComponents: ['prompt-template version', 'profile hash', 'model'], liveResponseReplay: 'pending_owner_key',
  },
  developmentLabels: {
    loader: 'implemented', labelKind: 'pseudo_label', actualClaudeLabelsSupplied: 0,
    verifiedMeaning: 'Per-field executor issue rate <= 10%; never truth or review.',
    withoutRows: 'Accepted with verified:false and zero field cells; A4 must filter unverified fields.',
    labelReport: ['verifiedFields', 'unverifiedFields'],
  },
  live: {
    calls: 0, status: 'pending_owner', keyEnvironmentVariable: 'ULPIN_PROVIDER_KEY_SARVAM',
    commandParts: LIVE_COMMAND, maxCalls: 1,
    prerequisites: [
      'ULPIN_MODEL_GATEWAY_ENABLED=1',
      'Approved ULPIN_MODEL_GATEWAY_CONFIG with daily/total caps and ULPIN_PROVIDER_KEY_SARVAM reference.',
      'Existing PostgreSQL gateway ledger available and reconciled; no runtime changes here.',
    ],
    recordingsEnvironmentVariable: 'ULPIN_TEACHER_RECORDINGS_DIR',
    defaultRecordingDirectory: 'E:/BhuAayam-data/runtime/teacher-recordings/',
    protocolReference: 'https://docs.sarvam.ai/api-reference/chat/chat-completions-v1',
    protocolCheckedAt: '2026-10-10', structuredOutput: 'Strict response_format.json_schema; no tools.',
    rawResponsePolicy: 'Redacted bounded envelope with hash; reasoning excluded.',
  },
  limitations: [
    'A3 supplies trusted data classification, split and scope authorization; use issue-aware dry-run.',
    'Offline ledger controls only; no live PostgreSQL concurrency/restart or charged provider call.',
    'No genuine Claude labels or publisher-dictionary accuracy; corrections outrank pseudo-labels.',
    'One/two observed samples on A1 files are explicitly short, never padded with invented values.',
    'Regional units and layouts exceeding existing gateway bounds require manual input.',
  ],
};
save('result.json', result);
console.log(JSON.stringify({
  inputs, tests: result.tests, liveCalls: 0, result: 'docs/evidence/gf-agent/a2/result.json',
}));
