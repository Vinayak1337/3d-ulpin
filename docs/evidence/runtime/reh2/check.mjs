import { readdirSync, readFileSync } from 'node:fs';

// Every file here: lines of 120 characters at most; JSON parses; no 64-hex run other than a recorded source
// SHA-256 or the image id; no connection string; no credential assignment.
const folder = 'docs/evidence/runtime/reh2';
const kept = new Set([
  'c231afe4940fed01f67af2c548bb970b6bf0ea30c1795aa71bed9fdf569387da',
  '31db0dd7ee5b1343120648b590709c3f71c48d264900dfefa3170d5d98864521',
  'f66bd7e9af672b75805bc1f839f2bec92dff2452595a31c4ddda5edd4dbd3c73',
  ...process.argv.slice(2),
]);
const problems = [];
let files = 0;
let lines = 0;
for (const name of readdirSync(folder).sort()) {
  const text = readFileSync(`${folder}/${name}`, 'utf8');
  files++;
  text.split('\n').forEach((line, index) => {
    lines++;
    if (line.length > 120) problems.push(`${name}:${index + 1} is ${line.length} characters`);
  });
  if (name.endsWith('.json')) {
    try { JSON.parse(text); } catch { problems.push(`${name} is not JSON`); }
  }
  for (const run of text.match(/[a-f0-9]{64,}/gi) ?? []) {
    if (!kept.has(run.toLowerCase())) problems.push(`${name} holds an unrecorded 64-hex run`);
  }
  if (/postgresql:\/\//i.test(text)) problems.push(`${name} holds a connection string`);
  if (/[A-Z0-9_]*(PASSWORD|SECRET|TOKEN|DATABASE_URL)[A-Z0-9_]*\s*[=:]\s*["']?[^\s"'[]{6,}/.test(text)) {
    problems.push(`${name} may hold a credential value`);
  }
}
console.log(JSON.stringify({ files, lines, problems }));
process.exitCode = problems.length ? 1 : 0;
