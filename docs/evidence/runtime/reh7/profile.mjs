// REH7 Part C: a summary of one Chromium CPU profile (Profiler domain, 1 ms samples) of the Studio's page. The page's
// main thread is never idle while the map is open (about two thirds `(program)`, the software WebGL render loop), so
// the long task is found as the longest run of 100 ms buckets in which JavaScript and GC fill 80% or more. Inside it,
// functions by self time and by inclusive time, each with its served module path and line (1-based, in the module
// as Vite serves it). Every 500 ms bucket's split (idle, program, gc, js; ms) and the page's long tasks over 1 s are
// listed beside it.
const short = url => url.replace(/^https?:\/\/[^/]+/, '').replace(/\?.*$/, '') || '(native)';
const frame = node => `${node.callFrame.functionName || '(anonymous)'} ${short(node.callFrame.url)}`
  + `${node.callFrame.url ? `:${node.callFrame.lineNumber + 1}` : ''}`;

export function summarise(profile, longTasks) {
  const nodes = new Map(profile.nodes.map(node => [node.id, node]));
  const parent = new Map();
  for (const node of profile.nodes) for (const child of node.children ?? []) parent.set(child, node.id);
  const times = [];
  let t = profile.startTime;
  for (const delta of profile.timeDeltas) times.push(t += delta);
  const kind = id => {
    const name = nodes.get(id).callFrame.functionName;
    return name === '(idle)' ? 'idle' : name === '(program)' ? 'program' : name === '(garbage collector)' ? 'gc' : 'js';
  };
  const weight = i => Math.max(0, ((times[i + 1] ?? times[i]) - times[i]) / 1000);
  const bucketOf = (i, us) => Math.floor((times[i] - profile.startTime) / us);
  const fine = new Map(), coarse = new Map();
  profile.samples.forEach((id, i) => {
    const k = kind(id);
    const row = fine.get(bucketOf(i, 1e5)) ?? { busy: 0, all: 0 };
    row.all += weight(i);
    if (k === 'js' || k === 'gc') row.busy += weight(i);
    fine.set(bucketOf(i, 1e5), row);
    const split = coarse.get(bucketOf(i, 5e5)) ?? { idle: 0, program: 0, gc: 0, js: 0 };
    split[k] += weight(i);
    coarse.set(bucketOf(i, 5e5), split);
  });
  // The longest run of consecutive 100 ms buckets that are 80% or more JavaScript and GC.
  let best = { first: 0, last: -1 }, first = null;
  const last = Math.max(...fine.keys());
  for (let b = 0; b <= last + 1; b++) {
    const row = fine.get(b);
    if (row && row.all > 0 && row.busy / row.all >= 0.8) {
      first ??= b;
      if (b - first > best.last - best.first) best = { first, last: b };
    } else first = null;
  }
  const inside = i => bucketOf(i, 1e5) >= best.first && bucketOf(i, 1e5) <= best.last;
  const self = new Map(), inclusive = new Map();
  for (let i = 0; i < profile.samples.length; i++) {
    if (!inside(i)) continue;
    const id = profile.samples[i];
    self.set(frame(nodes.get(id)), (self.get(frame(nodes.get(id))) ?? 0) + weight(i));
    const seen = new Set();
    for (let at = id; at !== undefined; at = parent.get(at)) {
      const name = frame(nodes.get(at));
      if (seen.has(name) || name.startsWith('(root)')) continue;
      seen.add(name);
      inclusive.set(name, (inclusive.get(name) ?? 0) + weight(i));
    }
  }
  const top = (map, n) => [...map].sort((a, b) => b[1] - a[1]).slice(0, n)
    .map(([name, ms]) => ({ ms: Math.round(ms), name }));
  return {
    sampledSeconds: Number(((times.at(-1) - profile.startTime) / 1e6).toFixed(1)), samples: profile.samples.length,
    longestJsStretch: { fromSecond: best.first / 10, toSecond: (best.last + 1) / 10,
      ms: (best.last - best.first + 1) * 100 },
    longTasksOver1s: longTasks.filter(task => task.ms > 1000),
    selfTime: top(self, 20), inclusiveTime: top(inclusive, 30),
    halfSecondSplitMs: [...coarse].sort((a, b) => a[0] - b[0]).map(([b, split]) => [b / 2,
      ...['idle', 'program', 'gc', 'js'].map(key => Math.round(split[key]))]),
  };
}
