import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = name => JSON.parse(readFileSync(`docs/evidence/gf1/lp2/${name}.json`, 'utf8'));
const runtime = read('runtime-final');
assert.equal(runtime.runtime.exit, 0);
assert.equal(runtime.ownedBoxGone, true);
const evidence = runtime.runtime.evidence;
assert.equal(evidence.originalsUnchanged, true);
assert.equal(evidence.providers, 0);
const result = evidence.results[0];
assert.equal(result.features, 1661);
assert.equal(result.unframedImport.sourceRanges, 0);
const cards = result.rangeAndWholeCards;
assert.equal(cards.length, 3);
for (const card of cards) {
  assert.equal(card.verification, 'consistent');
  assert.equal(card.nycByteComparison.whole.verified, 'consistent');
  assert.equal(card.nycByteComparison.byteIdentical, true);
  assert.equal(card.directPacketIdentical, true);
}
assert.equal(read('fixture-equivalence').records, 2);
assert(read('cost-excerpt-equivalence').every(item => item.identical));
const costs = ['nyc', 'niagara', 'halifax'].map(name => {
  const whole = read(`cost-${name}`);
  const range = read(`range-cost-${name}`);
  assert.equal(whole.excerptCharacters, range.excerptCharacters);
  return { name, originalBytes: whole.bytes, rangeBytes: range.rangeBytes,
    wholeMs: Number(whole.ms.toFixed(3)), rangeMs: Number(range.ms.toFixed(3)),
    wholePeakRssKiB: whole.peakRssKiB, rangePeakRssKiB: range.peakRssKiB };
});
console.log(JSON.stringify({ task: 'LP2', evidenceChecks: 'passed', recordedBuildings: result.features,
  rangeCards: cards.length, wholeCards: cards.length, costs,
  qualification: 'Receipt consistency check; rerun run-runtime.mjs and the adjacent tests for fresh runtime proof.' }));
