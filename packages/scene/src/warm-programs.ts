import {
  BackSide, BufferGeometry, Color, Float32BufferAttribute, InstancedMesh, LineSegments,
  Material, Mesh, MeshDepthMaterial, Scene, WebGLRenderTarget,
  type Camera, type Object3D, type WebGLRenderer,
} from 'three';

export interface ProgramWarmUp {
  startedAt: number;
  endedAt: number | null;
  settled: boolean;
  outcome: 'pending' | 'ready' | 'failed' | 'timeout';
  parallel: boolean;
}

export interface WarmMaterials {
  ground: Material;
  sidewalk: Material;
  edge: Material;
  water: Material;
  kerb: Material;
  publicLand: Material;
  crown: Material;
  trunk: Material;
  bldg: Material;
}

interface WarmObjects {
  color: Object3D[];
  depth: Object3D[];
  geometries: BufferGeometry[];
}

// Attribute carriers only: these triangles never enter the scene, bounds, labels or a render call.
function attributes(normals: boolean, facade = false): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  if (normals) {
    geometry.setAttribute('normal', new Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
    geometry.setAttribute('uv', new Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
  }
  if (facade) {
    geometry.setAttribute('color', new Float32BufferAttribute(new Float32Array(9).fill(1), 3));
    geometry.setAttribute('aSeed', new Float32BufferAttribute([0, 0, 0], 1));
  }
  return geometry;
}

function instanced(geometry: BufferGeometry, material: Material, tint: boolean): InstancedMesh {
  const object = new InstancedMesh(geometry, material, 1);
  if (tint) object.setColorAt(0, new Color());
  object.receiveShadow = true;
  return object;
}

/** The NYC area-view variants, using the engine's real shader hooks and material identities. */
export function warmProgramObjects(materials: WarmMaterials): WarmObjects {
  const surface = attributes(true);
  const line = attributes(false);
  const facade = attributes(true, true);
  const color: Object3D[] = [
    new Mesh(surface, materials.ground),
    new Mesh(surface, materials.sidewalk),
    new LineSegments(line, materials.edge),
    new Mesh(surface, materials.water),
    new LineSegments(line, materials.kerb),
    new Mesh(surface, materials.publicLand),
    instanced(surface, materials.crown, true),
    instanced(surface, materials.trunk, false),
    new Mesh(facade, materials.bldg),
  ];
  for (const object of color) if (object instanceof Mesh) object.receiveShadow = true;
  // Retain equivalent depth cache entries until the engine disposes its building material.
  const depthMaterials = Array.from({ length: 3 }, () => new MeshDepthMaterial({ side: BackSide }));
  const depth = [
    instanced(surface, depthMaterials[0]!, true),
    instanced(surface, depthMaterials[1]!, false),
    new Mesh(surface, depthMaterials[2]!),
  ];
  return { color, depth, geometries: [surface, line, facade] };
}

function depthContext(scene: Scene): Scene {
  const context = new Scene();
  // Shadow renderBufferDirect uses an empty (fogless) scene, but the real scene's light/shadow counts.
  scene.traverseVisible((object) => {
    if ('isLight' in object && object.isLight) context.add(object.clone());
  });
  return context;
}

function compileObjects(
  renderer: WebGLRenderer, camera: Camera, target: Scene, objects: Object3D[],
  renderTarget: WebGLRenderTarget | null, parallel = true,
): Promise<unknown> {
  const group = new Scene();
  group.add(...objects);
  const previous = renderer.getRenderTarget();
  try {
    renderer.setRenderTarget(renderTarget);
    if (parallel) return renderer.compileAsync(group, camera, target);
    renderer.compile(group, camera, target);
    return Promise.resolve();
  } finally {
    renderer.setRenderTarget(previous);
  }
}

function initializeProgram(renderer: WebGLRenderer, object: Object3D): void {
  const material = (object as Mesh).material as Material;
  const properties = renderer.properties.get(material) as {
    currentProgram?: { getUniforms(): unknown; getAttributes(): unknown };
  };
  // Without KHR, compileAsync's isReady is unconditional. This is the actual bounded per-program link check.
  properties.currentProgram?.getUniforms();
  properties.currentProgram?.getAttributes();
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function compileSerial(
  renderer: WebGLRenderer, camera: Camera, scene: Scene, objects: WarmObjects,
  target: WebGLRenderTarget, state: ProgramWarmUp,
): Promise<void> {
  const shadow = depthContext(scene);
  for (const [batch, context, output] of [
    [objects.color, scene, null], [objects.depth, shadow, target],
  ] as const) {
    for (const object of batch) {
      await nextFrame();
      if (state.settled) return;
      await compileObjects(renderer, camera, context, [object], output, false);
      if (state.settled) return;
      initializeProgram(renderer, object);
    }
  }
}

async function compileParallel(
  renderer: WebGLRenderer, camera: Camera, scene: Scene, objects: WarmObjects,
  target: WebGLRenderTarget, state: ProgramWarmUp,
): Promise<void> {
  // Compile in a frame of its own: the first frame still holds the engine's construction.
  await nextFrame();
  await nextFrame();
  if (state.settled) return;
  await Promise.all([
    compileObjects(renderer, camera, scene, objects.color, null),
    compileObjects(renderer, camera, depthContext(scene), objects.depth, target),
  ]);
}

function retireDepthWith(source: Material, objects: Object3D[], cancel: () => void): void {
  const retire = () => {
    cancel();
    for (const object of objects) ((object as Mesh).material as Material).dispose();
    source.removeEventListener('dispose', retire);
  };
  source.addEventListener('dispose', retire);
}

/** One construction-time attempt, fail-open after two seconds; neither path draws the carriers. */
export function startProgramWarmUp(
  renderer: WebGLRenderer, camera: Camera, scene: Scene, materials: WarmMaterials,
): ProgramWarmUp {
  const state: ProgramWarmUp = {
    startedAt: performance.now(), endedAt: null, settled: false, outcome: 'pending',
    parallel: renderer.extensions.has('KHR_parallel_shader_compile'),
  };
  const objects = warmProgramObjects(materials);
  const target = new WebGLRenderTarget(1, 1);
  const settle = (outcome: ProgramWarmUp['outcome']) => {
    if (state.settled) return;
    state.settled = true;
    state.outcome = outcome;
    state.endedAt = performance.now();
    for (const geometry of objects.geometries) geometry.dispose();
    target.dispose();
    clearTimeout(timer);
  };
  const timer = setTimeout(() => settle('timeout'), 2000);
  retireDepthWith(materials.bldg, objects.depth, () => settle('failed'));
  const work = state.parallel
    ? compileParallel(renderer, camera, scene, objects, target, state)
    : compileSerial(renderer, camera, scene, objects, target, state);
  void work.then(() => settle('ready'), () => settle('failed'));
  return state;
}
