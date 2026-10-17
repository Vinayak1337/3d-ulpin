// Read-only inventory: known stored pins only; no configuration, original or product file is changed.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const root = process.cwd();
const git = (...args) => execFileSync('git', args, { cwd: root });
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const portable = path => path.replaceAll(String.fromCharCode(92), '/');
const tracked = new Set(git('ls-files').toString().trim().split('\n'));
const entries = new Map();
const scopes = [];

function addPin(path, scope, expected = null) {
  if (!tracked.has(path)) return;
  if (!entries.has(path)) entries.set(path, []);
  entries.get(path).push({ scope, expected });
}

function addScope(id, checkedAt, expectedAt, onMismatch, files) {
  scopes.push({ id, checkedAt, expectedAt, onMismatch });
  for (const path of files) addPin(path, id);
}

function quotedTrackedPaths(file) {
  const text = readFileSync(file, 'utf8');
  return [...text.matchAll(/['"]([^'"\r\n]+)['"]/g)]
    .map(match => match[1]).filter(path => tracked.has(path));
}

function catalogue() {
  scopes.push({ id: 'api_producers', checkedAt: 'apps/api/scripts/pinned-sources.ts:34-36',
    expectedAt: 'docs/api/source-pins.json#/sourceSha256', onMismatch: 'OpenAPI --check refuses' });
  for (const [path, expected] of Object.entries(json('docs/api/source-pins.json').sourceSha256)) {
    addPin(path, 'api_producers', expected);
  }
  scopes.push({ id: 'api_receipts', checkedAt: 'scripts/api/check.py:53-54',
    expectedAt: 'docs/api/runtime-qualification.json#/receiptSha256 and additionalRuns',
    onMismatch: 'API-DOC: runtime receipt changed; exit 1' });
  const runtime = json('docs/api/runtime-qualification.json');
  for (const run of [runtime, ...runtime.additionalRuns]) addPin(run.receipt, 'api_receipts', run.receiptSha256);
}

function fixedPins() {
  scopes.push({ id: 'sql', checkedAt: 'packages/server/src/infrastructure/sql-loader.ts:38',
    expectedAt: 'database/manifest.json#/steps/*/sha256', onMismatch: 'refuse changed SQL' });
  for (const step of json('database/manifest.json').steps) addPin('database/' + step.file, 'sql', step.sha256);
  scopes.push({ id: 'obj_native_lock', checkedAt: 'scripts/usp/desktop-obj-read.py:62-64',
    expectedAt: 'docs/evidence/usp/native-obj/runtime-lock.json#/code',
    onMismatch: 'Pinned code changed; native execution refused' });
  for (const pin of Object.values(json('docs/evidence/usp/native-obj/runtime-lock.json').code)) {
    const path = [...tracked].find(candidate => portable(pin.path).endsWith('/' + candidate));
    if (path) addPin(path, 'obj_native_lock', pin.sha256);
  }
  scopes.push({ id: 'card_font', checkedAt: 'packages/server/src/modules/usp/packets/card-render-unicode.ts:64',
    expectedAt: 'CARD_UNICODE_FONT_SHA256 in that file:19', onMismatch: 'CARD_FONT_INTEGRITY' });
  addPin('packages/server/src/modules/usp/packets/card-fonts/NotoSansDevanagari.ttf', 'card_font',
    '14ec4af41f27482216d1c2229f417ff9b1425e1babb014e57d1d40d03229853e');
  scopes.push({ id: 'isolation_harness', checkedAt: 'scripts/usp/learning/model_isolation.py:75-79',
    expectedAt: 'HARNESS_SOURCE_SHA256 in that file:32 (CRLF-to-LF normalized)',
    onMismatch: 'harness source SHA256 drift before execution' });
  addPin('scripts/usp/security/appcontainer_audit.py', 'isolation_harness',
    '4a59a18e04cd6fe76590ba929f424271f3dacdfb19ccf5e65fc2ec8048fbdc7f');
}

function nativeFamilies() {
  for (const family of ['obj', 'gltf', 'ifc', 'dxf', 'kml', 'citygml', 'geoparquet']) {
    const base = 'packages/server/src/modules/usp/ingestion/' + family;
    const python = 'scripts/usp/' + family;
    const files = [...quotedTrackedPaths(base + '-config.ts'), ...quotedTrackedPaths(base + '.ts'),
      ...quotedTrackedPaths(python + '/profile.py')];
    files.push('packages/contracts/src/usp/' + family + '-ingestion.ts');
    for (const suffix of ['', '-config', '-processor', '-worker']) files.push(base + suffix + '.ts');
    addScope(family + '_reader_tools', [base + '.ts:26', base + '-config.ts:16-83', python + '/server.py'],
      'Canonical job input tools/readerSha256; configured external profile files[]; native runtime lock',
      'stale reader input or 503 TOOL_CHANGED; refused native execution', new Set(files));
  }
}

function otherScopes() {
  const definitions = [
    ['document', 'packages/server/src/modules/usp/ingestion/document-native.ts',
      'Canonical document job input.readerSha256', 'reader_changed; stale; reject private reads'],
    ['streaming', 'packages/server/src/modules/usp/ingestion/streaming-vector.ts',
      'Canonical streaming job input.readerSha256', 'reader_changed; stale; refuse publication'],
    ['mapping', 'packages/server/src/modules/usp/ingestion/chunk-mapping.ts',
      'Canonical mapping job input.converterSha256', 'stale/refuse mapping completion'],
    ['profile', 'packages/server/src/modules/usp/ingestion/streamed-profile.ts',
      'Canonical profile input.profilerSha256', 'stale/refuse generation'],
    ['semantic', 'packages/server/src/modules/usp/ingestion/semantic-chunks.ts',
      'Canonical publisher pin and explicit immutable-read aliases', 'refuse publication or stale read'],
    ['mvt', 'packages/server/src/modules/usp/tiles/compiler.ts',
      'Stored compiler codeSha256 and explicit immutable-read aliases', 'refuse compiler drift'],
    ['packet', 'scripts/usp/document-models/packet_region_loader.py',
      'Configured external packet-region profile files[] and profile SHA', 'refuse runtime or recipe drift'],
    ['learning', 'services/geo/geo/usp_learning/experiment.py',
      'Frozen external experiment codeSha256 per-path map', 'refuse code drift'],
    ['learning_compare', 'scripts/usp/learning/compare_reranker.py',
      'Frozen external plan.codeSha256 per-path map', 'refuse code drift'],
    ['learning_train', 'scripts/usp/learning/train_reranker_lora.py',
      'Frozen external plan.codeSha256 per-path map', 'refuse code drift'],
    ['isolation', 'services/geo/geo/usp_learning/resources.py',
      'Configured containment profile files/code and profile SHA', 'refuse helper before execution'],
    ['cityjson', 'packages/server/src/modules/usp/ingestion/cityjson.ts',
      'Canonical job.readerSha256; services/geo/geo/cityjson_processing.py compares request pin', 'stale/refuse'],
    ['validator', 'packages/server/src/modules/registry/cityjson-validation-config.ts',
      'Canonical validation input.tools; configured tool locks', 'stale/refuse validation'],
    ['point', 'packages/server/src/modules/usp/ingestion/point-batch.ts',
      'Canonical job input.readerSha256', 'stale/refuse'],
    ['raster', 'packages/server/src/modules/usp/ingestion/raster-window.ts',
      'Canonical job input.readerSha256', 'stale/refuse'],
    ['projected', 'packages/server/src/modules/usp/ingestion/projected-vector.ts',
      'Canonical job input parser pin', 'stale/refuse']
  ];
  for (const [id, file, expectedAt, onMismatch] of definitions) {
    addScope(id, file, expectedAt, onMismatch, quotedTrackedPaths(file));
  }
  for (const path of ['services/geo/geo/native_cityjson.py', 'services/geo/geo/cityjson_processing.py']) {
    addPin(path, 'cityjson');
  }
  addScope('image_recipe', ['packages/server/src/modules/usp/packets/image-region.ts:32-37',
    'scripts/usp/document-models/run_image_region.py:22-24'],
  'Saved image-region recipe worker/decoder/supervisor hashes', 'refuse changed recipe/result',
  ['run_image_region.py', 'run_image_inspection.py', 'run_trial.py']
    .map(name => 'scripts/usp/document-models/' + name));
}

function pinMatch(pin, working, index) {
  if (pin.expected === null) return 'unavailable';
  if (pin.expected === working && pin.expected === index) return 'both';
  if (pin.expected === index) return 'index';
  if (pin.expected === working) return 'working';
  return 'neither';
}

function row(path, pins, eol) {
  const working = hash(readFileSync(path));
  const index = hash(git('show', ':' + path));
  return { path, eol, working, index,
    pins: pins.map(pin => ({ ...pin, match: pinMatch(pin, working, index) })) };
}

catalogue();
fixedPins();
nativeFamilies();
otherScopes();
const eols = new Map(git('ls-files', '--eol').toString().trim().split('\n').map(line => {
  const [metadata, path] = line.split('\t');
  return [path, metadata.trim()];
}));
const table = [...entries].sort(([a], [b]) => a.localeCompare(b))
  .map(([path, pins]) => row(path, pins, eols.get(path)));
const snapshot = { scopes,
  tableColumns: ['path', 'git_ls_files_eol', 'working_sha256', 'index_sha256', 'pin_matches_by_scope'],
  table: table.map(entry => [entry.path, entry.eol, entry.working, entry.index,
    entry.pins.map(pin => pin.scope + '=' + pin.match)]),
  counts: {
  files: table.length,
  unavailable: table.filter(entry => entry.pins.every(pin => pin.match === 'unavailable')).length,
  neither: table.filter(entry => entry.pins.some(pin => pin.match === 'neither')).map(entry => entry.path),
  crlfPinnedWithLfIndex: table.filter(entry => entry.working !== entry.index &&
    entry.pins.some(pin => pin.match === 'working')).map(entry => entry.path)
} };
if (process.argv.includes('--step0')) {
  const path = 'docs/evidence/gf1/fx2/step0.json';
  writeFileSync(path, JSON.stringify({ ...json(path), ...snapshot }, null, 2) + '\n');
} else {
  console.log(JSON.stringify(snapshot, null, 2));
}
