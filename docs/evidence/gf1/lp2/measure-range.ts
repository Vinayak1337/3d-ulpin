import assert from 'node:assert/strict';
import { closeSync, openSync, readFileSync, readSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { featureRangeExtract } from '../../../../packages/server/src/modules/usp/packets/feature-extract';
import { sha256 } from '../../../../packages/server/src/infrastructure/storage';

const inputs = JSON.parse(readFileSync('docs/evidence/gf1/lp2/cost-ranges.json', 'utf8'));
const input = inputs[Number(process.argv[2])];
const range = input.range;
const raw = Buffer.alloc(range.byteEnd - range.byteStart);
const file = openSync(input.path, 'r');
try {
  assert.equal(readSync(file, raw, 0, raw.length, range.byteStart), raw.length);
} finally {
  closeSync(file);
}
const before = process.memoryUsage();
const start = performance.now();
const excerpt = featureRangeExtract(raw, range, { sourceFeatureIndex: range.featureIndex, properties: {} });
console.log(JSON.stringify({ ...input, rangeBytes: raw.length, ms: performance.now() - start,
  excerptCharacters: excerpt?.length ?? null, excerptSha256: excerpt === null ? null : sha256(excerpt),
  before, after: process.memoryUsage(), peakRssKiB: process.resourceUsage().maxRSS,
  memoryQualification: 'Fresh process; only the exact feature bytes loaded; peak RSS includes module loading.' }));
