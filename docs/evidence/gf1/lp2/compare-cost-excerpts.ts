import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { featurePropertiesExtract, featureRangeExtract }
  from '../../../../packages/server/src/modules/usp/packets/feature-extract';
import { sha256 } from '../../../../packages/server/src/infrastructure/storage';

const inputs = JSON.parse(readFileSync('docs/evidence/gf1/lp2/cost-ranges.json', 'utf8'));
const comparisons = inputs.map((input: any) => {
  const bytes = readFileSync(input.path);
  assert.equal(sha256(bytes), input.sourceSha256);
  const range = input.range;
  const whole = featurePropertiesExtract(bytes, range.featureIndex);
  const part = featureRangeExtract(bytes.subarray(range.byteStart, range.byteEnd), range,
    { sourceFeatureIndex: range.featureIndex, properties: {} });
  assert.equal(part, whole);
  assert(part);
  return { name: input.name, featureIndex: range.featureIndex, identical: true, excerptSha256: sha256(part),
    excerptCharacters: part.length };
});
writeFileSync('docs/evidence/gf1/lp2/cost-excerpt-equivalence.json',
  JSON.stringify(comparisons) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ comparisons: comparisons.length, identical: true }));
