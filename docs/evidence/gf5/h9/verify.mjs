import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = 'docs/evidence/gf5/h9';
const packages = readdirSync('node_modules/.pnpm');
const installed = packages.find((name) => /^ajv@8\./.test(name));
const { default: Ajv } = await import(pathToFileURL(resolve(
  'node_modules/.pnpm', installed, 'node_modules/ajv/dist/2020.js',
)).href);
const openapi = JSON.parse(readFileSync('docs/api/openapi.json', 'utf8'));
const ajv = new Ajv({ strict: false, validateFormats: false });
ajv.addSchema({ ...openapi, $id: 'h9' });
const before = JSON.parse(readFileSync(`${here}/before.json`, 'utf8'));
const mocked = JSON.parse(readFileSync(`${here}/mocked.json`, 'utf8'));
const ledger = await (await fetch('http://127.0.0.1:3194/api/v1/buildings/'
  + '6f95d04e-2067-4ac8-a3c2-6cc21ea46325/ledger')).json();
const queue = before.reads.queue.body;
const examples = [
  ['ledger-live', 'GET_buildings_buildingId_ledger_Response_200_application_json', ledger],
  ['queue-live', 'GET_work_queue_Response_200_application_json', queue],
  ['ledger-additive-mocked', 'GET_buildings_buildingId_ledger_Response_200_application_json',
    { ...ledger, history: { ...ledger.history, registry: mocked.registry } }],
  ['queue-additive-mocked', 'GET_work_queue_Response_200_application_json',
    { ...queue, items: queue.items.map((item) => ({
      ...item, ...mocked.caseRows.find((row) => row.id === item.id),
    })) }],
];
const contracts = examples.map(([name, type, answer]) => ({
  name, valid: ajv.validate({ $ref: `h9#/components/schemas/${type}` }, answer), errors: ajv.errors,
}));
const utf8 = { files: 0, failures: [] };
function scan(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) scan(path);
    else if (/\.(ts|tsx|css|json|mjs)$/.test(path)) {
      utf8.files += 1;
      try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(path));
        if (text.includes('\uFFFD')) utf8.failures.push({ path, reason: 'U+FFFD' });
      } catch {
        utf8.failures.push({ path, reason: 'Invalid UTF-8 / lone high byte' });
      }
    }
  }
}
scan('apps/studio/src');
const diff = execFileSync('git', ['diff', '616f630a', '--unified=0', '--', 'apps/studio'], { encoding: 'utf8' });
const longAddedLines = diff.split('\n').filter((line) =>
  line.startsWith('+') && !line.startsWith('+++') && line.slice(1).length > 120);
const result = { contracts, utf8, longAddedLines };
writeFileSync(`${here}/verification.json`, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result));
if (contracts.some((check) => !check.valid) || utf8.failures.length || longAddedLines.length) process.exitCode = 1;
