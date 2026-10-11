// Installed before the import mounts its engine. Never changes render state.
const describe = (program) => ({
  id: program.id, name: program.name, type: program.type, cacheKey: program.cacheKey,
});

function recordPrograms(renderer, probe, programs, seen, phase) {
  for (const candidate of renderer.info.programs) {
    if (seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    programs.events.push({ at: performance.now(), part: probe.parts.at(-1)?.sequence ?? null,
      phase, ...describe(candidate) });
  }
}

function instrumentCompile(renderer, probe, record) {
  const compile = renderer.compile;
  renderer.compile = function (...args) {
    const at = performance.now();
    try {
      return compile.apply(this, args);
    } finally {
      record('compile');
      probe.calls.push({ name: 'compile', at, ms: performance.now() - at });
    }
  };
}

function objectKind(engine, material, object, owner) {
  if (material.isMeshDepthMaterial) return 'shadow depth';
  if (object.isInstancedMesh) return 'tree';
  if (object.userData.entry) return 'building prism';
  if (object.userData.overlay) return 'overlay';
  if (material === engine.m.pad) return 'pad';
  if (object.isLine) return 'kerb/lane/edge line';
  return owner;
}

function instrumentDraw(engine, programs, record) {
  const renderer = engine.renderer;
  const names = new Map(Object.entries(engine.m).map(([name, material]) => [material, name]));
  const original = renderer.renderBufferDirect;
  const materialPrograms = new WeakMap();
  renderer.renderBufferDirect = function (camera, scene, geometry, material, object, group) {
    const used = materialPrograms.get(material) ?? new Set();
    const at = performance.now();
    const result = original.call(this, camera, scene, geometry, material, object, group);
    const program = renderer.properties.get(material).currentProgram;
    if (program && !used.has(program.id)) {
      used.add(program.id);
      materialPrograms.set(material, used);
      const owner = names.get(material) ?? material.type;
      programs.uses.push({ at, ms: performance.now() - at, material: owner,
        kind: objectKind(engine, material, object, owner),
        objectType: object.type, attributes: Object.keys(geometry.attributes),
        receiveShadow: object.receiveShadow, ...describe(program) });
    }
    record('render');
    return result;
  };
}

function instrumentFrames(engine, probe, programs) {
  const renderer = engine.renderer;
  const originalFrame = engine.renderFrame;
  engine.renderFrame = (now) => {
    const at = performance.now();
    const before = renderer.info.programs.map((program) => program.id);
    originalFrame(now);
    const after = renderer.info.programs.map(describe);
    const created = after.filter((program) => !before.includes(program.id));
    if (created.length) programs.frames.push({ at, ms: performance.now() - at,
      part: probe.parts.at(-1)?.sequence ?? null, created });
    if (!probe.firstPartDrawAt && engine.renderedBase.size) {
      probe.firstPartDrawAt = performance.now();
      programs.firstDrawn = after;
    }
    programs.final = after;
    if (engine.programWarmUp) probe.warmUp = { ...engine.programWarmUp };
  };
}

export function probePrograms(engine, probe) {
  const renderer = engine.renderer;
  const programs = probe.programs = { initial: [], events: [], uses: [], frames: [], final: [] };
  const seen = new Set();
  programs.initial = renderer.info.programs.map(describe);
  const record = (phase) => recordPrograms(renderer, probe, programs, seen, phase);
  instrumentCompile(renderer, probe, record);
  instrumentDraw(engine, programs, record);
  instrumentFrames(engine, probe, programs);
}
