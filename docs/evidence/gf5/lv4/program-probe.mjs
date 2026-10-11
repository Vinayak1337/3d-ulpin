// Installed from instrumentModules before the import mounts its engine. Never changes render state.
export function probePrograms(engine, probe) {
  const renderer = engine.renderer;
  const programs = probe.programs = { initial: [], events: [], uses: [], frames: [], final: [] };
  const seen = new Set();
  const names = new Map(Object.entries(engine.m).map(([name, material]) => [material, name]));
  const describe = (program) => ({
    id: program.id, name: program.name, type: program.type, cacheKey: program.cacheKey,
  });
  programs.initial = renderer.info.programs.map(describe);
  const original = renderer.renderBufferDirect;
  const materialPrograms = new WeakMap();
  renderer.renderBufferDirect = function (camera, scene, geometry, material, object, group) {
    const first = !materialPrograms.has(material);
    const at = first ? performance.now() : 0;
    const result = original.call(this, camera, scene, geometry, material, object, group);
    const program = renderer.properties.get(material).currentProgram;
    if (first && program) {
      materialPrograms.set(material, program.id);
      const owner = names.get(material) ?? material.type;
      let kind = owner;
      if (material.isMeshDepthMaterial) kind = 'shadow depth';
      else if (object.isInstancedMesh) kind = 'tree';
      else if (object.userData.entry) kind = 'building prism';
      else if (object.userData.overlay) kind = 'overlay';
      else if (material === engine.m.pad) kind = 'pad';
      else if (object.isLine) kind = 'kerb/lane/edge line';
      programs.uses.push({ at, ms: performance.now() - at, material: owner, kind,
        objectType: object.type, attributes: Object.keys(geometry.attributes),
        receiveShadow: object.receiveShadow, ...describe(program) });
    }
    for (const candidate of renderer.info.programs) {
      if (seen.has(candidate.id)) continue;
      seen.add(candidate.id);
      programs.events.push({ at: performance.now(), part: probe.parts.at(-1)?.sequence ?? null,
        ...describe(candidate) });
    }
    return result;
  };
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
