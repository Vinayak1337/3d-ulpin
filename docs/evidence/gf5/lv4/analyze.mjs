import { readFile } from 'node:fs/promises';
import { alignSamples, sampleStack, taskProfile } from '../lv3/profile.mjs';
import { writeEvidence } from './evidence-json.mjs';

const capture = process.env.LV4_CAPTURE;
const path = `docs/evidence/gf5/lv4/${capture}.json`;
const run = JSON.parse(await readFile(path, 'utf8'));
const timings = JSON.parse(await readFile(run.rawTimingFile, 'utf8'));
const profile = JSON.parse(await readFile(run.rawCpuFile, 'utf8'));
const alignment = alignSamples(sampleStack(profile, timings), timings);
run.tasks = timings.tasks.filter((task) => task.ms > 50 && task.at >= run.streamWindow.from
  && task.at <= run.streamWindow.to).map((task) => taskProfile(task, timings, alignment.samples));
run.sampleAlignment = { offsetMs: alignment.offsetMs, matchedMs: alignment.matchedMs };
run.programs.stallTable = run.tasks.map((task) => ({
  taskAt: task.at,
  taskMs: task.ms,
  topSelf: task.topSelf,
  frame: run.programs.frames.find((frame) => frame.at >= task.at && frame.at < task.at + task.ms),
  firstUses: run.programs.uses.filter((use) => use.at >= task.at && use.at < task.at + task.ms),
}));
delete run.longTasks;
await writeEvidence(path, run);
console.log(JSON.stringify({ capture, tasks: run.tasks, programs: run.programs.final,
  stallTable: run.programs.stallTable }));
