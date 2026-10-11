// Shared analysis of captured samples/call boundaries; never launches an import.
export function slope(points) {
  const mean = (key) => points.reduce((sum, point) => sum + point[key], 0) / points.length;
  const x = mean('x');
  const y = mean('y');
  return points.reduce((sum, point) => sum + (point.x - x) * (point.y - y), 0)
    / points.reduce((sum, point) => sum + (point.x - x) ** 2, 0);
}

export function partWork(lag, timings) {
  return lag.chunks.filter((part) => part.buildings).map((part) => {
    const next = lag.chunks[lag.chunks.indexOf(part) + 1]?.at ?? timings.end;
    const calls = timings.calls.filter((call) => call.at >= part.at && call.at < next);
    const total = (names) => calls.filter((call) => names.includes(call.name))
      .reduce((sum, call) => sum + call.ms, 0);
    return {
      x: part.buildingsBefore, y: total(['setBuildings', 'drainBuildingQueue', 'setBase', 'drainBaseQueue']),
      buildingOnly: part.count === part.buildings,
      buildingBuildMs: total(['addBuilding']), treeRefreshMs: total(['buildDressing']),
      baseRebuilds: calls.filter((call) => call.name === 'setBase' && call.rebuilt).length,
    };
  });
}

export function sampleStack(profile, timings) {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const parents = new Map();
  for (const node of profile.nodes) for (const child of node.children ?? []) parents.set(child, node.id);
  const duration = (profile.endTime - profile.startTime) / 1000;
  let at = timings.end - duration;
  return profile.samples.map((id, index) => {
    const ms = profile.timeDeltas[index] / 1000;
    at += ms;
    const stack = [];
    const urls = [];
    for (let current = id; current; current = parents.get(current)) {
      const frame = nodes.get(current).callFrame;
      stack.push(frame.functionName || '(anonymous)');
      urls.push(frame.url);
    }
    return { at, ms, stack, urls };
  });
}

export function frameProfile(frame, timings, samples) {
  const from = frame.at - frame.ms;
  const calls = timings.calls.filter((call) => call.at >= from && call.at < frame.at);
  const sampled = samples.filter((sample) => sample.at >= from && sample.at < frame.at);
  const groups = {};
  const leaves = {};
  const named = ['setBase', 'drainBaseQueue', 'addBuilding', 'buildDressing', 'renderFrame'];
  for (const sample of sampled) {
    const group = named.find((name) => sample.stack.includes(name)) ?? sample.stack[0];
    groups[group] = (groups[group] ?? 0) + sample.ms;
    leaves[sample.stack[0]] = (leaves[sample.stack[0]] ?? 0) + sample.ms;
  }
  const selected = calls.filter((call) =>
    ['setBase', 'drainBaseQueue', 'drainBuildingQueue', 'renderFrame'].includes(call.name));
  return {
    at: frame.at, gapMs: frame.ms, groupsMs: groups,
    topSelf: Object.entries(leaves).sort((a, b) => b[1] - a[1]).slice(0, 3),
    calls: selected.map((call) => [call.name, call.ms, call.buildings ?? call.queued ?? null]),
  };
}

function matchedSamples(samples, anchors, offsetMs) {
  let index = 0;
  let ms = 0;
  for (const sample of samples) {
    const at = sample.at + offsetMs;
    while (index < anchors.length && anchors[index].at + anchors[index].ms < at) index++;
    if (index < anchors.length && anchors[index].at <= at) ms += sample.ms;
  }
  return ms;
}

export function alignSamples(samples, timings) {
  const names = ['setBase', 'setBuildings', 'drainBaseQueue', 'drainBuildingQueue', 'renderFrame'];
  const groups = names.map((name) => ({
    samples: samples.filter((sample) =>
      names.find((candidate) => sample.stack.includes(candidate)) === name),
    anchors: timings.calls.filter((call) => call.name === name && call.ms > 2).sort((a, b) => a.at - b.at),
  }));
  let best = { offsetMs: 0, matchedMs: 0 };
  for (let offsetMs = -500; offsetMs <= 500; offsetMs++) {
    const matchedMs = groups.reduce((sum, group) =>
      sum + matchedSamples(group.samples, group.anchors, offsetMs), 0);
    if (matchedMs > best.matchedMs) best = { offsetMs, matchedMs };
  }
  return { samples: samples.map((sample) => ({ ...sample, at: sample.at + best.offsetMs })), ...best };
}

export function taskProfile(task, timings, samples) {
  const end = task.at + task.ms;
  const calls = timings.calls.filter((call) => call.at < end && call.at + call.ms > task.at);
  const selected = calls.filter((call) =>
    ['setBase', 'drainBaseQueue', 'drainBuildingQueue', 'renderFrame', 'setBuildings'].includes(call.name));
  const scene = samples.filter((sample) => sample.at >= task.at && sample.at <= end);
  const groups = {};
  for (const sample of scene) for (const name of new Set(sample.stack)) {
    if (name.startsWith('(')) continue;
    groups[name] = (groups[name] ?? 0) + sample.ms;
  }
  return {
    at: task.at, ms: task.ms,
    topInclusive: Object.entries(groups).sort((a, b) => b[1] - a[1]).slice(0, 5),
    topSelf: frameProfile({ at: end, ms: task.ms }, timings, samples).topSelf,
    overlappingCalls: selected.map((call) => ({ name: call.name, at: call.at, ms: call.ms })),
    topSceneOrLoader: Object.entries(groups).filter(([name]) =>
      /setBase|renderFrame|drainBaseQueue|drainBuildingQueue|inflate|decodeBlock|getTileOrStrip|readTiff/.test(name))
      .sort((a, b) => b[1] - a[1]).slice(0, 3),
    sceneOrStudioAttributable: selected.length > 0 || scene.some((sample) => sample.urls.some((url) =>
      /apps\/studio\/src|packages\/scene\/src|\/src\/(features|api|portal|app)\//.test(url))),
    decoderDuringStream: scene.some((sample) => sample.stack.includes('getTileOrStrip')),
  };
}
