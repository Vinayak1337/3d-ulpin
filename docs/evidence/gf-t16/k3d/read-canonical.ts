import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildings } from '../../../../scripts/golden-journey/inputs';
import { Reader, ok } from '../../../../scripts/golden-journey/read';
import { NormalizedBuildingSchema } from '../../../../packages/contracts/src/canonical/building';

async function main() {
  const directory = 'E:/BhuAayam-data/task-data/k3d/canonical-01';
  mkdirSync(directory, { recursive: true });
  const reader = new Reader();
  const observations = [];
  for (const buildingId of buildings) {
    const read = await reader.get('/api/v1/buildings/{buildingId}/canonical', { buildingId });
    const data = NormalizedBuildingSchema.parse(ok(read));
    assert.equal(read.method, 'GET');
    writeFileSync(join(directory, `${buildingId}.json`), JSON.stringify(data), { flag: 'wx' });
    observations.push({ buildingId, status: read.status, responseSha256: read.bodySha256,
      inputRevisions: data.inputRevisions, gaps: data.gaps, frame: data.frame,
      levels: data.levels.map(level => ({ levelId: level.levelId, label: level.label,
        lowerM: level.lowerM, upperM: level.upperM, spaces: level.spaces.length })),
      sources: [...new Set(data.levels.flatMap(level => level.label.citations.map(citation => citation.sourceId)))] });
  }
  writeFileSync(join(directory, 'receipt.json'), JSON.stringify({ observations, writes: 0 }), { flag: 'wx' });
  console.log(JSON.stringify(observations));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Canonical read failed');
  process.exitCode = 1;
});
