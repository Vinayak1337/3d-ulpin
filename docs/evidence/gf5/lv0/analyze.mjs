// Reanalyzes the same measured CPU profile; does not run the import or read source data.
import { readFile, writeFile } from 'node:fs/promises';
const directory = 'docs/evidence/gf5/lv0';
const lag = JSON.parse(await readFile(`${directory}/lag.json`, 'utf8'));
const profile = JSON.parse(await readFile(lag.rawCpuFile, 'utf8'));
const timings = JSON.parse(await readFile(lag.rawTimingFile, 'utf8'));
const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
const parents = new Map();
for (const node of profile.nodes) for (const child of node.children || []) parents.set(child, node.id);
const functions = {};
const total = profile.timeDeltas.reduce((sum, delta) => sum + delta, 0);
let idle = 0;
let program = 0;
for (let index = 0; index < profile.samples.length; index++) {
  const delta = profile.timeDeltas[index];
  const leaf = nodes.get(profile.samples[index]).callFrame.functionName;
  if (leaf === '(idle)') idle += delta;
  if (leaf === '(program)') program += delta;
  const visited = new Set();
  for (let id = profile.samples[index]; id; id = parents.get(id)) {
    const node = nodes.get(id);
    const name = node.callFrame.functionName;
    if (visited.has(name)) continue;
    visited.add(name);
    functions[name] = (functions[name] || 0) + delta;
  }
}
const selected = [
  'setBuildings', 'addFootprintBuilding', 'prismGeometry', 'EdgesGeometry', 'edgeGeometry', 'clearEntries',
  'setBase', 'fitGroundAndShadow', 'buildDressing', 'treeMeshes', 'renderFrame', 'setQueryData',
  'toFootprints', 'toBase', 'MapWorkspace', 'SceneView', 'ImportTray', 'ImportStream', 'BuildingSearch',
];
const percent = (us, denominator) => Math.round(10000 * us / denominator) / 100;
const sampled = total - idle - program;
lag.cpu.inclusiveFunctions = selected.map((name) => ({
  name, ms: (functions[name] || 0) / 1000,
  percentOfAll: percent(functions[name] || 0, total),
  percentOfAttributedActive: percent(functions[name] || 0, sampled),
}));
lag.cpu.idleMs = idle / 1000;
lag.cpu.unattributedProgramMs = program / 1000;
lag.cpu.attributedActiveMs = sampled / 1000;
lag.cpu.inclusiveWarning = 'Inclusive functions overlap; zero means no sample, not zero execution.';
const scene = timings.calls.filter((call) => call.name === 'setBuildings' && call.after > 0);
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
const xMean = mean(scene.map((call) => call.before));
const yMean = mean(scene.map((call) => call.ms));
const covariance = scene.reduce((sum, call) => sum + (call.before - xMean) * (call.ms - yMean), 0);
const variance = scene.reduce((sum, call) => sum + (call.before - xMean) ** 2, 0);
const yVariance = scene.reduce((sum, call) => sum + (call.ms - yMean) ** 2, 0);
lag.hypothesis = {
  sceneCostGrows: true, measuredCalls: scene.length,
  slopeMsPerPriorBuilding: covariance / variance,
  pearsonR: covariance / Math.sqrt(variance * yVariance),
  summedBuildingsPassedToReplacement: scene.reduce((sum, call) => sum + call.after, 0),
  cacheCopyExistsButDominantCostNotConfirmed: true,
};
lag.frameDurations = timings.frames.filter((frame) => frame.at >= lag.streamWindow.from
  && frame.at <= lag.streamWindow.to + 17).map((frame) => [frame.at - lag.streamWindow.from, frame.ms]);
if (lag.environment.userAgent) {
  lag.environment.browser = lag.environment.userAgent.match(/HeadlessChrome\/[^ ]+/)?.[0];
  delete lag.environment.userAgent;
}
const round = (key, value) => typeof value === 'number' ? Math.round(value * 1000) / 1000 : value;
lag.cpu.topSelfFunctions = lag.cpu.topSelfFunctions.map((entry) => ({
  ...entry, name: entry.name.replace(/node_modules\/\.vite\/deps\//, 'deps/'),
}));
const json = JSON.stringify(lag, round, 2).replace(/\[\s+(-?[\d.]+),\s+(-?[\d.]+)\s+\]/g, '[$1, $2]');
await writeFile(`${directory}/lag.json`, json + '\n');
console.log(JSON.stringify({ hypothesis: lag.hypothesis, idleMs: lag.cpu.idleMs,
  unattributedMs: lag.cpu.unattributedProgramMs, functions: lag.cpu.inclusiveFunctions }, null, 2));
