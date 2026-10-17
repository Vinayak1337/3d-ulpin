import { readFileSync } from 'node:fs';
import { keep, safe, save } from './audit.mjs';

// REH2's save-b.mjs for REH3: a phase's receipt from scratch into evidence; digests other than the sources' are
// omitted, lines packed to 120.
const phase = process.argv[2];
const raw = readFileSync(`E:/BhuAayam-data/task-data/reh3/part-c-${phase}.raw.json`, 'utf8');
for (const digest of process.argv.slice(3)) keep(digest);
save(`part-c-${phase}.json`, JSON.parse(safe(raw)));
console.log(`part-c-${phase}.json`);
