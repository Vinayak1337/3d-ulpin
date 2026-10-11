import { readFile } from 'node:fs/promises';
import { writeEvidence } from './evidence-json.mjs';

const directory = 'docs/evidence/gf5/lv4';
const load = async (name) => JSON.parse(await readFile(`${directory}/${name}.json`, 'utf8'));
const headless = await load('lv4-before');
const headed = await load('lv4-before-headed');
const inventory = headless.programs.final.map((program) => {
  const uses = headless.programs.uses.filter((use) => use.id === program.id);
  const event = headless.programs.events.find((event) => event.id === program.id);
  let material = uses.map((use) => use.material);
  if (program.id === 10) material = ['shadow depth, trunk instancing without instanceColor'];
  if (program.id === 11) material = ['shadow depth, ordinary building prism'];
  if (program.id === 0) material = ['internal WebGLBackground 2D sky texture'];
  return { ...program, material, firstPartSequence: event?.part,
    firstUseAt: event?.at, beforeFirstChunk: event?.at < headless.streamWindow.from };
});
const tables = [headless, headed].map((run) => ({
  environment: run.environment,
  table: run.programs.stallTable.map((stall) => ({ ...stall,
    frame: stall.frame ?? run.programs.frames.find((frame) => frame.at < stall.taskAt + stall.taskMs
      && frame.at + frame.ms > stall.taskAt) })),
}));
await writeEvidence(`${directory}/step0.json`, {
  baselineGit: headless.git,
  commands: [
    'LV1_CAPTURE=lv4-before node docs/evidence/gf5/lv4/measure.mjs',
    'LV1_CAPTURE=lv4-before-headed LV2_HEADED=1 node docs/evidence/gf5/lv4/measure.mjs',
  ],
  confirmedShaderFirstUse: [headless, headed].every((run) =>
    run.tasks.every((task) => task.topSelf[0][0] === 'onFirstUse')),
  tables,
  programCount: inventory.length,
  inventory,
  cacheKeyInputs: [
    'One hemisphere and one shadow-casting directional light; counts and shadow-map type enter every key.',
    'Fog is on in the color scene, off for the shadow pass; clipping stays at zero in this area view.',
    'bldg uses vertexColors and normals; crowns use instancing plus instanceColor, trunks instancing only.',
    'UVs matter when a map is sampled; flatShading is false with normals; receiveShadow is a uniform, not a key.',
    'Output is srgb on the canvas, srgb-linear for shadow targets; tone mapping and side/depth packing enter keys.',
  ],
  threeVersion: '0.186.1',
  source: [
    'packages/scene/node_modules/three/src/renderers/webgl/WebGLPrograms.js getParameters/getProgramCacheKey',
    'packages/scene/node_modules/three/src/renderers/WebGLRenderer.js compile/compileAsync',
    'packages/scene/node_modules/three/src/renderers/webgl/WebGLProgram.js onFirstUse/isReady',
    'packages/scene/node_modules/three/src/renderers/webgl/WebGLShadowMap.js getDepthMaterial',
  ],
  compileAsync: {
    withExtension: 'compile links programs; compileAsync polls COMPLETION_STATUS_KHR every 10 ms until ready.',
    withoutExtension: 'After 10 ms isReady returns true unconditionally; first uniform/attribute access can block.',
    shadows: 'No depth preparation for these non-node materials. Three depth variants first appear on part 9.',
    depthPlan: 'Compile BackSide BasicDepthPacking proxies with ordinary/instanced/instanceColor attributes.',
    depthContext: 'Same light/shadow counts, no fog, linear render-target output; retain materials until renderer teardown.',
    background: 'Internal sky program is already drawn at metadata, before first feature part; not reproduced as a shader.',
  },
  limits: [
    'Probe times first material use and program creation without changing any render state.',
    'Depth inventory distinguishes variants by cache key; the initial probe times only the first use of a material.',
    'The engine is constructed after metadata, not on the upload page; measure the actual constructor lead time.',
  ],
});
