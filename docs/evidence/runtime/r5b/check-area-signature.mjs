// Rebuilds the text the area import signs from request A2 in area-step.json and compares its SHA-256 with the
// importSignature the demo answered. Offline: reads two committed files and sends nothing.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const retained = read('../../gf-backend/k2/gmda-import.json');
const { fields } = read('./area-step.json').requests.find(request => request.id === 'A2');

// The same keys in the same order as packages/server/src/modules/areas/areas.ts:886-899.
const signed = JSON.stringify({
  namespace: fields.namespace.value,
  format: fields.format.value,
  layer: null,
  normalization: 'canonical-area-officer-v1',
  name: fields.name.value,
  areaId: retained.areaId,
  mapping: fields.mapping.value,
  worldStatus: fields.worldStatus.value,
  sourceCrs: fields.sourceCrs.value,
});
const computed = createHash('sha256').update(signed).digest('hex');
const same = computed === retained.importSignature;
console.log(JSON.stringify({ retained: retained.importSignature, computed, same }));
if (!same) process.exitCode = 1;
