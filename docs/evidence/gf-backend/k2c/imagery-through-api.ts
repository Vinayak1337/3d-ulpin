import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { ImageryAreaImportSchema, NormalizedAreaSchema } from '../../../../packages/contracts/src/index';

const base = 'http://127.0.0.1:3194/api/v1';
const evidence = 'docs/evidence/gf-backend/k2c';
const clusterId = '6933:7322:1640';
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
type Chip = { id: string; cluster_id: string; source_image: { local_path: string; sha256: string } };
const index = JSON.parse(readFileSync('E:/BhuAayam-data/datasets/ramp/coco/source-index-karnataka.json', 'utf8'));
const chips: Chip[] = index.items.filter((chip: Chip) => chip.cluster_id === clusterId);
assert.equal(chips.length, 22);

function save(name: string, value: unknown): void {
  writeFileSync(`${evidence}/${name}.json`, JSON.stringify(value) + '\n', { flag: 'wx' });
}

async function request(path: string, init?: RequestInit): Promise<any> {
  const response = await fetch(`${base}${path}`, { ...init, signal: AbortSignal.timeout(120_000) });
  const value = await response.json();
  assert(response.ok, `${response.status}: ${JSON.stringify(value)}`);
  return value;
}

function form(input: ReturnType<typeof ImageryAreaImportSchema.parse>): FormData {
  const body = new FormData();
  body.set('format', 'imagery_area');
  body.set('metadata', JSON.stringify(input));
  for (const chip of chips) {
    const bytes = readFileSync(chip.source_image.local_path);
    assert.equal(digest(bytes), chip.source_image.sha256);
    body.set(chip.id, new File([bytes], `${chip.id}.tif`, { type: 'image/tiff' }));
  }
  return body;
}

async function install(): Promise<void> {
  assert(!existsSync(`${evidence}/imagery-import.json`), 'Existing import receipt: do not install twice.');
  const requestPath = `${evidence}/imagery-import-request.json`;
  if (!existsSync(requestPath)) save('imagery-import-request', {
    format: 'imagery_area', clusterId, requestKey: randomUUID(),
  });
  const input = ImageryAreaImportSchema.parse(JSON.parse(readFileSync(requestPath, 'utf8')));
  const pkg = await request('/import-packages', { method: 'POST', body: form(input) });
  assert.equal(pkg.features.length, 0);
  assert.equal(pkg.imagery.chips.length, chips.length);
  save('imagery-import', pkg);
  const area = NormalizedAreaSchema.parse(await request(`/areas/${pkg.areaId}/canonical`));
  assert.equal(area.buildings.length, 0);
  assert.equal(area.overlays.length, chips.length);
  assert.equal(area.frame.origin.hEllipsoidal, null);
  save('imagery-before-inference', area);
  console.log(`Installed ${chips.length} unchanged imagery chips; zero physical features; area ${pkg.areaId}.`);
}

await install();
