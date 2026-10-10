// Owner-run switch for the demo model gateway: status | enable --config <policy.json> | disable, and for a
// list of keys: keys --from <file> | key-marks | reconcile --reason <text> | restore-key <NAME> --reason <text>.
// Prints key names, counts and the report facts only, never a value. The gateway chooses the key; this never does.
import { spawnSync } from 'node:child_process';
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  demoFile, gatewayConfigKey, gatewayFlag, gatewayPolicyHash, providerKeyName, providerKeyNames, readDemo,
  readDemoSettings, redact, safeEnvironment, teacherAdapterKey,
} from './demo-config.mjs';
import { ownedProcess } from './processes.mjs';
import { root } from './runtime.mjs';

const usage = [
  'Usage: demo-gateway.mjs status | enable --config <policy.json> | disable',
  '  | keys --from <file> [--dry-run --out <folder> --settings <file>]',
  '  | key-marks | reconcile --reason <text> | restore-key <NAME> --reason <text>',
].join('\n');
const nativeLabels = ['api', 'dispatcher'];
const rewrittenKeys = [gatewayFlag, gatewayConfigKey, teacherAdapterKey];
const anyKeyName = new RegExp(`^${providerKeyName}(_[0-9]{2})?$`);
const listedKeyLine = new RegExp(`^${providerKeyName}_[0-9]{2}=`);
const listedKeyName = index => `${providerKeyName}_${String(index + 1).padStart(2, '0')}`;

/** As mappingTeacherGatewayRuntime() resolves it: live needs the enabled gateway and its key; the rest is manual. */
function resolvedTeacherAdapter(env, liveAvailable) {
  const mode = env[teacherAdapterKey] ?? 'replay';
  if (mode === 'replay') return 'replay';
  if (mode === 'sarvam' && liveAvailable) return 'sarvam';
  return 'manual';
}

/**
 * The seven facts `status` and the doctor print. No key value, prefix or length.
 * Enabled: the policy names the keys, and providerKeyPresent says every one of them is there.
 * Disabled: no policy names a key, so providerKeysPresent counts the Sarvam key lines that hold a value.
 */
export function gatewayReport(env) {
  const enabled = env[gatewayFlag] === '1';
  const policy = enabled ? JSON.parse(env[gatewayConfigKey]) : undefined;
  const named = enabled ? providerKeyNames(policy) : [];
  const counted = enabled ? named : Object.keys(env).filter(name => anyKeyName.test(name));
  const providerKeysPresent = counted.filter(name => Boolean(env[name])).length;
  const providerKeyPresent = enabled ? providerKeysPresent === named.length : providerKeysPresent > 0;
  return {
    enabled,
    policyHash: enabled ? gatewayPolicyHash(env[gatewayConfigKey]) : null,
    providerKeyPresent,
    mappingTeacherAdapter: resolvedTeacherAdapter(env, enabled && providerKeyPresent),
    dailyCapPresent: enabled && Boolean(policy.projectDailyCapMicroInr),
    providerKeysNamed: named.length,
    providerKeysPresent,
  };
}

export function gatewayReportLines(report) {
  return Object.entries(report).map(([fact, value]) => `${fact}: ${value}`);
}

function runningDemoProcesses() {
  return nativeLabels.filter(label => ownedProcess(label));
}

function assertDemoStopped(running) {
  const labels = running();
  if (labels.length) {
    throw new Error(`Demo ${labels.join(' and ')} recorded as running; a running process would not see the change. `
      + 'Stop the demo first.');
  }
}

function readPolicyFile(policyFile) {
  try { return JSON.stringify(JSON.parse(readFileSync(policyFile, 'utf8'))); }
  catch { throw new Error('The policy file must be readable, valid JSON.'); }
}

function readText(file) {
  const bytes = readFileSync(file);
  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes)) throw new Error('Demo configuration is not valid UTF-8.');
  return text;
}

function lineIndex(lines, key) {
  const matches = lines.flatMap((line, index) => (line.startsWith(`${key}=`) ? [index] : []));
  if (matches.length > 1) throw new Error(`Demo configuration repeats ${key}.`);
  return matches.length ? matches[0] : -1;
}

/** Replaces the key's line where it stands; a missing line is added directly after the anchor key's line. */
function setLine(lines, key, value, anchorKey) {
  const index = lineIndex(lines, key);
  if (index >= 0) lines[index] = `${key}=${value}`;
  else lines.splice(lineIndex(lines, anchorKey) + 1, 0, `${key}=${value}`);
}

function removeLine(lines, key) {
  const index = lineIndex(lines, key);
  if (index >= 0) lines.splice(index, 1);
}

function enableLines(lines, policyJson) {
  setLine(lines, gatewayFlag, '1');
  setLine(lines, gatewayConfigKey, policyJson, gatewayFlag);
  setLine(lines, teacherAdapterKey, 'sarvam', gatewayConfigKey);
}

function disableLines(lines) {
  setLine(lines, gatewayFlag, '0');
  removeLine(lines, gatewayConfigKey);
  // A replay or manual choice is the owner's and stays; only the live selection is removed.
  if (lines.includes(`${teacherAdapterKey}=sarvam`)) removeLine(lines, teacherAdapterKey);
}

/** Rewrites only the three gateway lines; every other line and the file's newline style stay byte-identical. */
function rewriteGatewayLines(text, policyJson) {
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(newline);
  if (lines.some(line => /[\r\n]/.test(line))) throw new Error('Demo configuration mixes newline styles.');
  if (lineIndex(lines, gatewayFlag) < 0) throw new Error(`Demo configuration lacks ${gatewayFlag}.`);
  if (policyJson === null) disableLines(lines);
  else enableLines(lines, policyJson);
  return lines.join(newline);
}

function gatewayLine(text, key) {
  return text.split(/\r?\n/).find(line => line.startsWith(`${key}=`));
}

/** The copy is checked by the reader the runtime uses, then renamed over the file; a refused copy is removed. */
function replaceChecked(file, text) {
  const copy = join(dirname(file), `${basename(file)}.${process.pid}.tmp`);
  try {
    writeFileSync(copy, text, { flag: 'wx', mode: 0o600 });
    readDemoSettings(copy);
    renameSync(copy, file);
  } catch (error) {
    rmSync(copy, { force: true });
    throw error;
  }
}

/** Shared by enable (policy JSON) and disable (null). Returns the names of the keys whose lines changed. */
function switchGateway(file, policyJson, running) {
  assertDemoStopped(running);
  const before = readText(file);
  const after = rewriteGatewayLines(before, policyJson);
  if (after === before) {
    readDemoSettings(file);
    return [];
  }
  replaceChecked(file, after);
  return rewrittenKeys.filter(key => gatewayLine(before, key) !== gatewayLine(after, key));
}

export function enableGateway({ policyFile, file = demoFile, running = runningDemoProcesses }) {
  return switchGateway(file, readPolicyFile(policyFile), running);
}

export function disableGateway({ file = demoFile, running = runningDemoProcesses } = {}) {
  return switchGateway(file, null, running);
}

/** One key per line in the order of use; blank lines are skipped. A refusal names a position, never the text. */
function readKeyList(keysFile) {
  let keys;
  try { keys = readText(keysFile).split(/\r?\n/).map(line => line.trim()).filter(Boolean); }
  catch { throw new Error('The keys file must be readable UTF-8 text.'); }
  if (keys.length < 2 || keys.length > 32) throw new Error('The keys file must hold 2 to 32 keys, one per line.');
  const invalid = keys.findIndex(key => key.length > 8192 || /[\s\x00-\x1f\x7f]/.test(key));
  if (invalid >= 0) throw new Error(`Key ${invalid + 1} of the keys file is not one key without spaces.`);
  if (new Set(keys).size !== keys.length) throw new Error('The keys file repeats a key.');
  return keys;
}

/** Replaces the numbered key lines with the new list at the end of the file; every other line stays as it is. */
function rewriteKeyLines(text, keys) {
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(newline).filter(line => !listedKeyLine.test(line));
  const end = lines.at(-1) === '' ? lines.length - 1 : lines.length;
  lines.splice(end, 0, ...keys.map((key, index) => `${listedKeyName(index)}=${key}`));
  return lines.join(newline);
}

/**
 * Owner step: the keys of the owner's file become numbered key lines of the demo settings. Returns names only.
 * With outFolder it is a rehearsal: the result is written there as a new file and the settings stay untouched.
 */
export function writeKeyList({ keysFile, file = demoFile, outFolder, running = runningDemoProcesses }) {
  const keys = readKeyList(keysFile);
  const after = rewriteKeyLines(readText(file), keys);
  if (outFolder) writeFileSync(join(outFolder, 'demo-settings-after-keys.txt'), after, { flag: 'wx', mode: 0o600 });
  else {
    assertDemoStopped(running);
    replaceChecked(file, after);
  }
  return keys.map((_key, index) => listedKeyName(index));
}

/** One owner step on the ledger, in a TypeScript child with the demo settings. Its lines name keys, never values. */
function runLedgerStep(args, env = readDemo()) {
  const preload = join(root, 'scripts/platform/isolated-env.cjs');
  const entry = join(root, 'scripts/platform/demo-gateway-ledger.ts');
  const result = spawnSync(process.execPath, ['--require', preload, '--import', 'tsx', entry, ...args],
    { cwd: root, env: safeEnvironment(env), encoding: 'utf8', timeout: 60000, windowsHide: true });
  const lines = redact(`${result.stdout ?? ''}\n${result.stderr ?? ''}`, env).split(/\r?\n/).filter(Boolean);
  if (result.status !== 0) throw new Error(lines.at(-1) ?? 'The ledger step did not run.');
  return lines;
}

/** key-marks, reconcile and restore-key. The owner's reason is required where the ledger records one. */
export function ledgerStep(action, options, step = runLedgerStep) {
  const reasonAt = action === 'restore-key' ? 1 : 0;
  const reasoned = options.length === reasonAt + 2 && options[reasonAt] === '--reason'
    && /^[^\x00-\x1f\x7f]{3,300}$/.test(options[reasonAt + 1].trim());
  if (action === 'key-marks' && options.length === 0) return step(['key-marks']);
  if (action === 'reconcile' && reasoned) return step(['reconcile', options[1].trim()]);
  if (action === 'restore-key' && reasoned && anyKeyName.test(options[0])) {
    return step(['restore-key', options[0], options[2].trim()]);
  }
  throw new Error(usage);
}

function printStatus() {
  gatewayReportLines(gatewayReport(readDemoSettings())).forEach(line => console.log(line));
}

function printKeys([from, keysFile, ...rest]) {
  // A rehearsal writes the whole settings text with the keys in it, so it never starts from the demo settings.
  const rehearsal = rest.length === 5 && rest[0] === '--dry-run' && rest[1] === '--out' && rest[2]
    && rest[3] === '--settings' && rest[4];
  if (from !== '--from' || !keysFile || rest.length && !rehearsal) throw new Error(usage);
  const names = writeKeyList({ keysFile, outFolder: rehearsal ? rest[2] : undefined,
    file: rehearsal ? rest[4] : demoFile });
  console.log(`${names.length} keys ${rehearsal ? 'would be ' : ''}written as ${names[0]} to ${names.at(-1)}`);
  console.log(`secretReferences for the policy file: ${JSON.stringify(names)}`);
  if (rehearsal) console.log('Rehearsal only: the demo settings were not changed.');
}

function printChange(changedKeys) {
  console.log(changedKeys.length ? `Changed: ${changedKeys.join(', ')}` : 'No line changed.');
  printStatus();
}

function run([action, ...options]) {
  if (action === 'status' && options.length === 0) return printStatus();
  if (action === 'disable' && options.length === 0) return printChange(disableGateway());
  if (action === 'enable' && options.length === 2 && options[0] === '--config') {
    return printChange(enableGateway({ policyFile: options[1] }));
  }
  if (action === 'keys') return printKeys(options);
  return ledgerStep(action, options).forEach(line => console.log(line));
}

const entry = process.argv[1] ? resolve(process.argv[1]).toLowerCase() : '';
// The doctor imports the report functions; importing must not run a command.
if (entry === fileURLToPath(import.meta.url).toLowerCase()) {
  try { run(process.argv.slice(2)); }
  catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
