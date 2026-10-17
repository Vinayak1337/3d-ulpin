import { readFileSync } from 'node:fs';
import { keep, safe, save } from './audit.mjs';

// A phase's receipt from scratch into evidence: digests other than the sources' are omitted, lines packed to 120.
keep('107561166456f2c3aa4d6c6510c46e3b9a7c9eb91824762fbf7ba47b0d05ac8e');
const phase = process.argv[2];
const raw = readFileSync(`E:/BhuAayam-data/task-data/reh2/part-b-${phase}.raw.json`, 'utf8');
save(`part-b-${phase}.json`, JSON.parse(safe(raw)));
console.log(`part-b-${phase}.json`);
