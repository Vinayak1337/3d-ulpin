// Owner-run switch for the demo model gateway: status | enable --config <policy.json> | disable.
// Prints key names and the five report facts only, never a value. One key: it never lists, picks or rotates keys.
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  demoFile, gatewayConfigKey, gatewayFlag, gatewayPolicyHash, providerKeyName, readDemoSettings, teacherAdapterKey,
} from './demo-config.mjs';
import { ownedProcess } from './processes.mjs';

const usage = 'Usage: demo-gateway.mjs status | enable --config <policy.json> | disable';
const nativeLabels = ['api', 'dispatcher'];
const rewrittenKeys = [gatewayFlag, gatewayConfigKey, teacherAdapterKey];

/** As mappingTeacherGatewayRuntime() resolves it: live needs the enabled gateway and its key; the rest is manual. */
function resolvedTeacherAdapter(env, liveAvailable) {
  const mode = env[teacherAdapterKey] ?? 'replay';
  if (mode === 'replay') return 'replay';
  if (mode === 'sarvam' && liveAvailable) return 'sarvam';
  return 'manual';
}

/** The five facts `status` and the doctor print. No key value, prefix or length. */
export function gatewayReport(env) {
  const enabled = env[gatewayFlag] === '1';
  const providerKeyPresent = Boolean(env[providerKeyName]);
  return {
    enabled,
    policyHash: enabled ? gatewayPolicyHash(env[gatewayConfigKey]) : null,
    providerKeyPresent,
    mappingTeacherAdapter: resolvedTeacherAdapter(env, enabled && providerKeyPresent),
    dailyCapPresent: enabled && Boolean(JSON.parse(env[gatewayConfigKey]).projectDailyCapMicroInr),
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

function printStatus() {
  gatewayReportLines(gatewayReport(readDemoSettings())).forEach(line => console.log(line));
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
  throw new Error(usage);
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
