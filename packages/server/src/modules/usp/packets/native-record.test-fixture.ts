import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { withFeaturePlan, type FeaturePlanStore } from './feature-plan.test-fixture';
import { sha256 } from '../../../infrastructure/storage';
import type { NativeRecordDecoder } from './feature-extract';

const root = 'E:/BhuAayam-data/datasets/map-formats/tweed-shire-council/';
export const nativeInputs = [
  { format: 'shapefile_zip' as const, name: 'TSC_Buildings_OD_8831041243266425049.zip', idField: 'Building_N' },
  { format: 'gpkg' as const, name: 'TSC_Buildings_OD_-1703359794462598529.gpkg', idField: 'OBJECTID' },
];

export function nativePython(input: unknown) {
  const code = 'import sys,json;sys.path.insert(0,"services/geo");'
    + 'from geo.native_gis import normalize_native;print(json.dumps(normalize_native(json.load(sys.stdin))))';
  const result = spawnSync('E:/BhuAayam-data/task-data/lv0/python/Scripts/python.exe', ['-B', '-c', code], {
    input: JSON.stringify(input), encoding: 'utf8', timeout: 60000, maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, PROJ_NETWORK: 'OFF', PYTHONDONTWRITEBYTECODE: '1' },
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

export const realNativeDecoder: NativeRecordDecoder = async (bytes, reference) => nativePython({
  format: reference.format, operation: 'decode_record', base64: bytes.toString('base64'), nativeRecord: reference,
});

function testGeoSettings() {
  const added: string[] = [];
  for (const [name, value] of [['GEO_URL', 'http://127.0.0.1:31999'],
    ['GEO_SERVICE_TOKEN', 'native-record-test-control']]) {
    if (!Object.hasOwn(process.env, name)) {
      process.env[name] = value;
      added.push(name);
    }
  }
  return () => { for (const name of added) delete process.env[name]; };
}

export async function withNativeFeaturePlan(input: typeof nativeInputs[number],
  work: (store: FeaturePlanStore) => Promise<void>) {
  await withFeaturePlan(0, async store => {
    store.original = readFileSync(root + input.name);
    const parsed = nativePython({ format: input.format, base64: store.original.toString('base64'),
      mapping: { kind: 'building', idField: input.idField } });
    store.source = { ...store.source, name: input.name, profile: `${input.format}-area-v2`,
      bytes: store.original.length, sha256: sha256(store.original) };
    store.features[0].body = { ...store.features[0].body, ...parsed.features[0], sourceRevisionId: store.source.id };
    const locator = `feature ${parsed.features[0].sourceKey}`;
    store.pointer.locator.locator = locator;
    store.pointer.legacyLocator = locator;
    store.record.body.evidence[0].locator = locator;
    store.record.body.name = parsed.features[0].name;
    const restore = testGeoSettings();
    const fetch = globalThis.fetch;
    globalThis.fetch = async (_url, init) => {
      assert(init?.body && typeof init.body === 'string');
      const request = JSON.parse(init.body);
      assert.equal(request.operation, 'decode_record');
      return new Response(JSON.stringify(nativePython(request)), { status: 200 });
    };
    try {
      await work(store);
    } finally {
      globalThis.fetch = fetch;
      restore();
    }
  });
}
