import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const directory = 'docs/evidence/runtime/reh1';
const before = JSON.parse(readFileSync(`${directory}/before.json`, 'utf8'));
const sources = JSON.parse(readFileSync(`${directory}/input-integrity.json`, 'utf8'));
const allowed = new Set([before.image.id.replace('sha256:', ''), sources.roads.sha256,
  ...sources.pdfs.map(source => source.sourceSha256)]);
const area = JSON.parse(readFileSync('docs/evidence/runtime/r5b/area-step.json', 'utf8'));
area.originals.forEach(source => allowed.add(source.sha256));
let files = 0;
let digests = 0;
function scan(path) {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const file = join(path, entry.name);
    if (entry.isDirectory()) {
      scan(file);
      continue;
    }
    const text = readFileSync(file, 'utf8');
    files++;
    assert(!/postgres(?:ql)?:\/\//i.test(text), `${file}: connection URI`);
    const assignments = /\b[A-Z0-9_]*(?:_PASSWORD|_SECRET\w*|_TOKEN|DATABASE_URL)\b\s*[=:]\s*["']?[^\s,}]+/g;
    assert(!assignments.test(text), `${file}: credential assignment`);
    for (const match of text.matchAll(/[a-f0-9]{64,}/gi)) {
      digests++;
      assert(allowed.has(match[0]), `${file}: unqualified digest`);
    }
    text.split(/\r?\n/).forEach((line, index) => {
      assert(line.length <= 120, `${file}:${index + 1}: over 120 characters`);
    });
    if (file.endsWith('.json')) JSON.parse(text);
  }
}
scan(directory);
console.log(`PASS ${files} files; ${digests} digest occurrences are recorded source SHA-256 or image ID only.`);
