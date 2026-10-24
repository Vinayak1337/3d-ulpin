// Keep the receipt small; full program keys, frames and task profiles remain in immutable raw captures.
import { readFile } from 'node:fs/promises';
import { writeEvidence } from './evidence-json.mjs';

const directory = 'docs/evidence/gf5/lv4';
const names = ['lv4-before', 'lv4-before-headed', 'lv4-after', 'lv4-headed', 'lv4-throttled'];
for (const name of names) {
  const path = `${directory}/${name}.json`;
  const run = JSON.parse(await readFile(path, 'utf8'));
  const timings = JSON.parse(await readFile(run.rawTimingFile, 'utf8'));
  const programs = timings.programs;
  const first = new Set(programs.firstDrawn.map((program) => program.cacheKey));
  run.programSummary = {
    initial: programs.initial.length,
    firstDrawn: programs.firstDrawn.length,
    final: programs.final.length,
    createdAfterFirstDrawn: programs.final.filter((program) => !first.has(program.cacheKey)).length,
    fullProgramKeysAndUses: `${run.rawTimingFile}:programs`,
  };
  if ((run.tasks?.length ?? 0) > 3) {
    run.longTasksOver50 = run.tasks.length;
    delete run.tasks;
  }
  delete run.programs;
  await writeEvidence(path, run);
}
