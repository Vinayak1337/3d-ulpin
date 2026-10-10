import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { profileColumnFile } from '../../packages/server/src/modules/usp/ingestion/column-profile';
const digest = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const inputs = [
  {
    path: 'E:/BhuAayam-data/task-data/desktop-ai04e-native-xlsx/'
      + 'Senior_Staff_Hospitality_Received__Cabinet_Office_.xlsx',
    manifest: 'docs/evidence/usp/native-xlsx/sources.json',
    headerRow: 5,
    columns: 3,
  },
  {
    path: 'E:/BhuAayam-data/task-data/native-ods-20261004-run01/originals/home-office-hospitality-2021-q3.ods',
    manifest: 'docs/evidence/usp/native-ods/sources.json',
    headerRow: 1,
    columns: 5,
  },
];
for (const input of inputs) {
  const sha256 = digest(input.path);
  assert(
    readFileSync(input.manifest, 'utf8').includes(sha256),
    'Use manifest-pinned unchanged originals only.',
  );
  const table = profileColumnFile(input.path, undefined, input.headerRow);
  assert.equal(table.profile.columns.length, input.columns);
  assert.equal(table.profile.sampleShortfall, false);
  for (const column of table.profile.columns)
    assert(column.maskedSamples.length >= 5 && column.maskedSamples.length <= 20);
  assert.equal(digest(input.path), sha256);
  console.log(
    JSON.stringify({
      input: input.path,
      sha256,
      rows: table.rows.length,
      columns: table.profile.columns.length,
      layoutFingerprint: table.profile.layoutFingerprint,
      sourceUnchanged: true,
      purpose: 'test_only_foreign_reader_mechanics',
    }),
  );
}
