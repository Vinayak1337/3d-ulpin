import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { featurePropertiesExtract } from '../../../../packages/server/src/modules/usp/packets/feature-extract';

const inputs = [
  { name: 'NYC', path: 'E:/BhuAayam-data/datasets/nyc-10013/files/buildings-original.geojson', index: 1620 },
  { name: 'Niagara Falls', path: 'E:/BhuAayam-data/datasets/map-formats/niagara-falls/'
    + 'Niagara_Falls_Building_Footprints_2018_1330698285055863645.geojson', index: 42246 },
  { name: 'Halifax', path: 'E:/BhuAayam-data/datasets/map-formats/halifax-regional-municipality/'
    + 'Buildings_4912564227567820355.geojson', index: 172408 },
];
const input = inputs[Number(process.argv[2])];
const bytes = readFileSync(input.path);
const before = process.memoryUsage();
const start = performance.now();
const excerpt = featurePropertiesExtract(bytes, input.index);
console.log(JSON.stringify({ ...input, bytes: bytes.length, ms: performance.now() - start,
  excerptCharacters: excerpt?.length ?? null, before, after: process.memoryUsage(),
  peakRssKiB: process.resourceUsage().maxRSS,
  memoryQualification: 'Fresh process; peak RSS includes module loading and the retained input buffer.' }));
