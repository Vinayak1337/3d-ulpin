import { readFileSync, writeFileSync } from 'node:fs';

// Preserve immutable, unabridged local receipts; Git carries facts and paths rather than hundreds of targets.
for (const name of ['runtime-first', 'runtime-diagnostic', 'runtime-choice', 'runtime', 'runtime-qualified']) {
  const path = `docs/evidence/gf1/lq1b/${name}.json`;
  const text = readFileSync(path, 'utf8');
  const receipt = JSON.parse(text);
  const raw = `E:/BhuAayam-data/task-data/lq1b/${receipt.container.split('-').at(-1)}/${name}-raw.json`;
  const evidence = receipt.runtime?.evidence;
  if (!evidence) continue;
  writeFileSync(raw, text, { flag: 'wx' });
  receipt.unabridged = raw;
  for (const key of ['targets', 'readyChoice']) {
    if (!evidence[key]) continue;
    const { items, ...page } = evidence[key];
    evidence[key] = { ...page, returnedItems: items.length };
  }
  if (evidence.confirmation) {
    const { progress, ...confirmation } = evidence.confirmation;
    evidence.confirmation = { ...confirmation, returnedProgress: progress.length };
  }
  evidence.jobs = tally(evidence.jobs, row => `${row.operation}: ${row.status}`);
  evidence.calls = tally(evidence.calls, row => `${row.label} ${row.method} ${row.path} ${row.status}`);
  writeFileSync(path, `${JSON.stringify(receipt)}\n`);
}

function tally(rows, key) {
  const groups = new Map();
  for (const row of rows) {
    const id = key(row);
    const previous = groups.get(id);
    groups.set(id, previous ? { ...previous, occurrences: previous.occurrences + 1 }
      : { ...row, occurrences: 1 });
  }
  return [...groups.values()];
}
