import { readdirSync, readFileSync } from 'node:fs';

// Every file here: lines of 120 characters at most; JSON parses; no 64-hex run other than a recorded source
// SHA-256 or an image id; no connection string; no credential assignment. Screenshots (PNG) are not scanned.
const folder = 'docs/evidence/runtime/reh4';
const kept = new Set([
  'c231afe4940fed01f67af2c548bb970b6bf0ea30c1795aa71bed9fdf569387da',
  '31db0dd7ee5b1343120648b590709c3f71c48d264900dfefa3170d5d98864521',
  'f66bd7e9af672b75805bc1f839f2bec92dff2452595a31c4ddda5edd4dbd3c73',
  'b444427f51942b4a5a30b1a6b770d050f135ef2b3c28ecded547ae1902cc9985',
  '107561166456f2c3aa4d6c6510c46e3b9a7c9eb91824762fbf7ba47b0d05ac8e',
  // SHA-256 of the NYC layer originals ZF1 kept from the archive (part-c-nyc.json lineage).
  '9a0c9f23bfd6a0b6ba71ab628ee25159e6b3754b4c40231d4a8090259e19c6cf',
  '12c95a1d8d065cadbcc2b68a61f14ce91f93798fe7bc28885fb7ea062efce192',
  'e1711a90ad63d9cbac4a9320e09b15ac91b9fa3995920ff4c06dbafd68977d13',
  'caf05fa5c76cc3eb1d6d2fb43c494ce0bd6416b97946012adddba623e203cf7f',
  '5f62c00a689303b30f85c1ec82c823f80b5e59ed1878c5f6cfbd0ad5932012b9',
  ...process.argv.slice(2),
]);
const problems = [];
let files = 0;
let lines = 0;
for (const name of readdirSync(folder).sort().filter(name => !name.endsWith('.png'))) {
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
