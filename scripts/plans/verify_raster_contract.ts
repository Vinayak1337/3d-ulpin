import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  BuildingCandidateRefSchema,
  BuildingCitationSchema,
  BuildingMethodSchema,
} from '../../packages/contracts/src/canonical/building';

type Room = { method: string; citations: unknown[]; state: string; level: { value: null; state: string } };
type Panel = { candidates: unknown[]; rooms: Room[] };
type Receipt = { panels: { output: { path: string } }[] };

function main(): void {
  const evidence = resolve(process.argv[2] ?? 'docs/evidence/gf-ai/plans/raster/20261011-tower3');
  const receipt = JSON.parse(readFileSync(resolve(evidence, 'tower3-current/result.json'), 'utf8')) as Receipt;
  let count = 0;
  for (const item of receipt.panels) {
    const panel = JSON.parse(readFileSync(item.output.path, 'utf8')) as Panel;
    assert.equal(panel.candidates.length, panel.rooms.length);
    for (const candidate of panel.candidates) BuildingCandidateRefSchema.parse(candidate);
    for (const room of panel.rooms) {
      BuildingMethodSchema.parse(room.method);
      for (const citation of room.citations) BuildingCitationSchema.parse(citation);
      assert.equal(room.state, 'candidate');
      assert.deepEqual(room.level, { value: null, state: 'unknown' });
      count += 1;
    }
  }
  console.log(JSON.stringify({ schema: 'normalized-building/1 candidates element', panels: 4, candidates: count }));
}

main();
