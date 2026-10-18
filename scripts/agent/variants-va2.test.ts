import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { developmentManifest } from './t1-sources';
import {
  buildCandidate, CAP, decide, dryRun, foldOf, OUTPUT, REASONS, seedNamesFloorCount, seedRecords,
  type DryRun, type Variant,
} from './variants-va2';

// Real opf-d07 seeds; the height seed is the one target with a unit the verifier must see in the header.
const records = seedRecords(['opf-d07']);
const height = records.find(record => record.seed.target === 'building.heightM');
assert(height);
const seeds = new Map(records.map(record => [record.seed.seedProfileId, record.seed]));
let runs = 0;
const scratch = () => join(OUTPUT, `checks/test-${process.pid}-${Date.now()}-${runs++}`);

function variant(headerVariant: string): Variant {
  return { seedProfileId: height!.seed.seedProfileId, target: 'building.heightM', headerVariant,
    neighbourVariants: {}, style: 'software_control', labelKind: 'synthetic_variant', method: 'control' };
}

async function verify(headers: string[]) {
  const variants = headers.map(variant);
  const candidates = variants.map((entry, index) => buildCandidate(index + 1, entry, height!, records));
  return { variants, candidates, checked: await dryRun(candidates, scratch()) };
}

test('a variant with the seed unit re-samples real values of its fold and passes the dry-run', async () => {
  const { variants, candidates, checked } = await verify(['Height in ft']);
  const [candidate] = candidates;
  const values = new Set(height.values.map(value => JSON.stringify(value)));
  assert(candidate.entry.rows!.every(row => values.has(JSON.stringify(Object.values(row)[0]))));
  assert.equal(candidate.link.cellCount, height.link.cellCount);
  assert.equal(candidate.link.declaredUnit, 'ft');
  assert.deepEqual(checked.get(1), { verified: true, codes: [] });
  assert.deepEqual(decide(variants, seeds, checked), { kept: [1], drops: [] });
});

test('near-duplicates of the seed and of a kept variant are dropped with their reason', () => {
  const variants = ['HEIGHT FEET', 'Height in ft', 'height-in-FT'].map(variant);
  const checked = new Map<number, DryRun>([1, 2, 3].map(line => [line, { verified: true, codes: [] }]));
  const { kept, drops } = decide(variants, seeds, checked);
  assert.deepEqual(kept, [2]);
  assert.deepEqual(drops.map(drop => [drop.line, drop.reason, drop.duplicateOf]),
    [[1, REASONS.seedDuplicate, undefined], [3, REASONS.keptDuplicate, 2]]);
});

test('a variant whose header loses the unit is refused by the existing verifier', async () => {
  const { variants, checked } = await verify(['Building Height']);
  assert.equal(checked.get(1)?.verified, false);
  const { kept, drops } = decide(variants, seeds, checked);
  assert.deepEqual(kept, []);
  assert.equal(drops[0].reason, REASONS.dryRun);
  assert(drops[0].codes?.includes('MAPPING_UNIT_NOT_DECLARED'));
});

test('the cap keeps at most twenty variants of one seed', () => {
  const variants = Array.from({ length: CAP + 1 }, (_, index) => variant(`Height ft ${index}`));
  const checked = new Map<number, DryRun>(variants.map((_, index) => [index + 1, { verified: true, codes: [] }]));
  const { kept, drops } = decide(variants, seeds, checked);
  assert.equal(kept.length, CAP);
  assert.deepEqual(drops.map(drop => [drop.line, drop.reason]), [[CAP + 1, REASONS.cap]]);
});

test('fold rule: a variant keeps its seed family; blind, pool and unlisted families are refused', () => {
  const candidate = buildCandidate(1, variant('Height in ft'), height, records);
  assert.equal(candidate.link.family, height.seed.family);
  assert.equal(candidate.link.split, 'dev');
  const blind = [...developmentManifest().heldOut][0];
  assert(blind);
  assert.throws(() => foldOf({ family: blind, split: 'dev' }), /VA2_FOLD_DENIED/);
  assert.throws(() => foldOf({ family: height.seed.family, split: 'pool' }), /VA2_FOLD_DENIED/);
  assert.throws(() => foldOf({ family: 'opf-unlisted-software-control', split: 'dev' }), /VA2_FOLD_DENIED/);
  assert.throws(() => buildCandidate(1, variant('Height in ft'), { ...height,
    seed: { ...height.seed, family: blind } }, records), /VA2_FOLD_DENIED/);
});

test('the storeyLabel rule drops only seeds whose header names a count of floors', () => {
  assert(seedNamesFloorCount({ target: 'building.storeyLabel', header: 'Sanctioned No of Floor' }));
  assert(seedNamesFloorCount({ target: 'building.storeyLabel', header: 'Number of Floors' }));
  assert(!seedNamesFloorCount({ target: 'building.storeyLabel', header: 'Floor' }));
  assert(!seedNamesFloorCount({ target: 'building.storeyCount', header: 'NUMBER OF FLOORS' }));
});
