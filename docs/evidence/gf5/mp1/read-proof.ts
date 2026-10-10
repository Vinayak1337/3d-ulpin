import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NormalizedAreaSchema } from '../../../../packages/contracts/src/canonical/building';

// Consumes only MP1's saved GET responses; never opens a runtime or a source-data directory.
const root = 'E:/BhuAayam-data/task-data/mp1/';
const read = (name: string) => JSON.parse(readFileSync(root + name, 'utf8'));
const area = NormalizedAreaSchema.parse(read('canonical-get.json'));
const context = read('context-get.json');
const originals = read('original-observations.json');
const previews = read('preview-observations.json');

assert.equal(context.features.length, 0);
assert.equal(context.displayFeatures.length, 1);
assert.equal(area.imagery?.length, 1);
assert.equal(area.imagery?.[0].chips.length, 22);
assert.equal(area.overlays.length, 22);
assert.equal(area.candidates?.length, 80);
assert.equal(new Set(originals.map((row: { sourceId: string }) => row.sourceId)).size, 22);
assert.equal(previews.length, 22);

const good = previews.find((row: { itemId: string }) => row.itemId === '0092d536-2800-45f4-95d9-e28801a3d195');
const difficult = previews.find((row: { itemId: string }) => row.itemId === '6024d2eb-a18c-4732-8f14-d57b932209f4');
assert.equal(good.candidateCount, 2);
assert.equal(difficult.state, 'empty');
assert.equal(difficult.candidateCount, 0);
assert.equal(difficult.format, 'PNG');
assert.ok(area.overlays.some(row => row.id === difficult.sourceId));

console.log('MP1: canonical schema valid; context 0 recorded / 1 proposal; 80 roofprints.');
console.log('Imagery 1 / chips 22 / overlays 22; good 2 roofs; difficult empty keeps imagery.');
console.log('Before = after: no product change, source link or new derivative needed.');
