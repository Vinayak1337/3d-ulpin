import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { constants, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { save } from './audit.mjs';

// New rehearsal inputs only; every member and the short table keep their existing source bytes.
const scratch = 'E:/BhuAayam-data/task-data/reh11';
const datasets = 'E:/BhuAayam-data/datasets';
const geojson = `${datasets}/nyc-10013/files/buildings-original.geojson`;
const lpc = `${datasets}/nyc-10013-linked/nyc-landmarks-preservation-commission/2537.pdf`;
const metadata = `${datasets}/nyc-10013-linked/nyc-office-of-technology-and-innovation/Metadata_BuildingFootprints.md`;
const short = `${scratch}/lpc-register-two-records-test_only.csv`;
const originalShort = 'E:/BhuAayam-data/task-data/reh10/lpc-register-two-records-test_only.csv';
const archive = `${scratch}/nyc-map-and-report-test_only.zip`;
const { zipSync } = createRequire('E:/Projects/ulpin-wt/ulpin-reh-02/package.json')('fflate');
copyFileSync(originalShort, short, constants.COPYFILE_EXCL);
const table = readFileSync(short);
assert.equal(table.at(-1), 10, 'Short CSV must end in LF');
const members = { 'buildings-original.geojson': readFileSync(geojson), '2537.pdf': readFileSync(lpc) };
writeFileSync(archive, zipSync(members, { level: 6 }), { flag: 'wx' });
const files = [short, archive, metadata].map(path => {
  const bytes = readFileSync(path);
  return { path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
});
save('act2-inputs.json', { files, members: Object.entries(members).map(([name, bytes]) => ({
  name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
})), provenance: 'Existing public NYC originals; foreign test_only, permission unconfirmed; not unseen.',
  sources: ['docs/api/real-sources.md: DA2 and DA3', 'docs/api/datasets.json'],
  shortCsv: 'Unchanged REH10 byte-exact prefix: header and two LPC records, final LF.',
  noAcquisition: true, noExternalProvider: true });
console.log(files.map(({ path, bytes }) => ({ path, bytes })));
