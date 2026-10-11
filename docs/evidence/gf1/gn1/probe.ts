import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { MappingPlanSchema, SourceProfileSchema } from '../../../../packages/contracts/src/usp';
import { compileMapping, inspectedProfile } from '../../../../packages/server/src/modules/usp/ingestion/registry';
import { officerQuestion } from '../../../../packages/server/src/modules/usp/ingestion/intake-draft-worker';
import { AppError } from '../../../../packages/server/src/infrastructure/errors';

const files = [
  'E:/BhuAayam-data/datasets/map-formats/niagara-falls/Niagara_Falls_Condominiums_7254610803234545967.geojson',
  'E:/BhuAayam-data/datasets/nyc-10013/files/buildings-original.geojson',
  'E:/BhuAayam-data/datasets/nyc-second-area/nyc-office-of-technology-and-innovation/'
    + '5zhs-2jue-box-w74.003-s40.732-e73.992-n40.740.geojson',
];
const python = 'E:/BhuAayam-data/ml/venv-k3a-geo/Scripts/python.exe';
const code = 'import sys,json;sys.path.insert(0,"services/geo");from geo.gis_inspection import inspect_gis;'
  + 'print(json.dumps(inspect_gis(json.load(sys.stdin))))';

function inspection(bytes: Buffer) {
  const result = spawnSync(python, ['-B', '-c', code], { encoding: 'utf8', timeout: 30000,
    input: JSON.stringify({ base64: bytes.toString('base64') }),
    env: { ...process.env, PROJ_NETWORK: 'OFF', PYTHONDONTWRITEBYTECODE: '1' } });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function refusal(work: () => unknown) {
  try {
    work();
    return null;
  } catch (error: any) {
    return { code: error.code, words: error.message, status: error.status };
  }
}

function plan(inventory: ReturnType<typeof inspectedProfile>, kind?: 'parcel') {
  const id = randomUUID();
  const { schemaFingerprint, ...fields } = inventory;
  const profile = SourceProfileSchema.parse({ ...fields, caseId: id, workspaceRevision: 0,
    workspaceFingerprint: 'a'.repeat(64), source: { sourceId: id, familyId: id,
      sourceRevision: 1, sourceSha256: 'b'.repeat(64), schemaFingerprint } });
  const prefix = kind ? 'feature' : 'building';
  const parsed = MappingPlanSchema.parse({ version: profile.version, mode: 'manual_mapping',
    source: profile.source, caseId: id, workspaceRevision: 0, workspaceFingerprint: profile.workspaceFingerprint,
    ...(kind ? { kind } : {}), operations: [
      { target: `${prefix}.sourceKey`, sourcePath: '/features/*/properties/OBJECTID',
        conversionId: 'literal_identifier@1' },
      { target: `${prefix}.geometry`, sourcePath: '/features/*/geometry',
        conversionId: kind ? 'geojson_geometry@1' : 'geojson_polygon@1' },
    ] });
  return refusal(() => compileMapping(parsed, profile));
}

function main() {
  const records = files.map(path => {
    const bytes = readFileSync(path);
    const inspected = inspection(bytes);
    const rejection = refusal(() => inspectedProfile(bytes, inspected));
    if (rejection) {
      const control = inspectedProfile(bytes, { ...inspected, sourceCrs: 'EPSG:4326' });
      return { path, inspection: { sourceCrs: inspected.sourceCrs, crsEvidence: inspected.crsEvidence },
        profileRefusal: rejection, textIdentifierAfterDegreeGuardBypass: plan(control, 'parcel'),
        bypass: 'Pure mechanical control only: inspection sourceCrs relabelled in memory to expose next guard.' };
    }
    const inventory = inspectedProfile(bytes, inspected);
    return { path, crs: inventory.crs, schemaFingerprint: inventory.schemaFingerprint,
      features: inventory.featureCount, paths: inventory.paths.map(item => ({ path: item.path, types: item.types })) };
  });
  const duplicate = new AppError(409, 'STALE_REVISION',
    'This destination already exists; pin its current area and reference explicitly.');
  console.log(JSON.stringify({ baseCommit: '814807ca489208ac9a8e31005f138f3a20ee4a1a', records,
    duplicateBefore: { code: duplicate.code, words: duplicate.message, rowReason: officerQuestion(duplicate),
      workerEffect: 'fail stores no waiting reason; job failed, row retains earlier planned/probed state.' } }));
}

main();
