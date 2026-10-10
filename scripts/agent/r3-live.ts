// R3 resumes the Tower 3 identity journey from the existing recorded space. It reuses R2's exchange helpers and
// records every request and response under its own create-once root. No configuration, SQL or provider call.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { counts } from './r2-live';

const root = 'E:/BhuAayam-data/task-data/r3';

async function main() {
  const [action, stage] = process.argv.slice(2);
  if (action === 'counts') {
    assert(stage && /^[a-z0-9-]+$/.test(stage));
    return counts(stage, root);
  }
  throw new Error('Use counts <stage>');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
