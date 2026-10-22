import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

// Offline evidence hygiene and cross-receipt invariants; does not start or query any runtime.
const directory = new URL('./', import.meta.url);
const load = name => JSON.parse(readFileSync(new URL(name, directory), 'utf8'));
const originals = [...load('act1-files.json').files, ...load('act2-inputs.json').files,
  ...load('act2-inputs.json').members];
const allowed = new Set(originals.flatMap(row => [row.sha256, row.recordedSha256]).filter(Boolean));
for (const image of load('before.json').images) allowed.add(image.id.replace(/^sha256:/, ''));
const failures = [];
for (const name of readdirSync(directory)) {
  const text = readFileSync(new URL(name, directory), 'utf8');
  text.split(/\r?\n/).forEach((line, index) => {
    if (line.length > 120) failures.push(`${name}:${index + 1}: long line`);
  });
  for (const match of text.matchAll(/[a-f0-9]{64,}/gi)) {
    if (!allowed.has(match[0].toLowerCase())) failures.push(`${name}: unclassified digest`);
  }
  if (/postgres(?:ql)?:\/\/[^\s"']+/i.test(text)) failures.push(`${name}: connection string`);
  if (/\b[A-Z0-9_]*(?:PASSWORD|SECRET|TOKEN|DATABASE_URL)[A-Z0-9_]*\s*=\s*[^\s]+/.test(text)) {
    failures.push(`${name}: credential assignment`);
  }
  if (name.endsWith('.json')) JSON.parse(text);
}
const result = load('result.json');
assert.equal(result.demo.unchanged, true);
assert.equal(result.end.volumesUnchanged, true);
assert.equal(result.act1.card.cardId, null);
assert.equal(result.act1.card.counts.carded, 0);
assert.equal(result.act1.evidence.accepted, 100);
assert.equal(result.journey.transport.allGET, true);
assert.equal(result.journey.transport.onlyTarget, true);
assert.equal(result.journey.summary.skipped, 2);
assert.equal(result.console.duplicateKeyWarnings, 0);
assert.deepEqual(failures, []);
console.log(`${readdirSync(directory).length} evidence files: JSON, line limits, secret scan and invariants passed.`);
