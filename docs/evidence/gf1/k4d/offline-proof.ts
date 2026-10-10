/** Native runtime proof with local-file transport; no HTTP, database, model, OCR or current-access claim. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { readDemoDocumentRuntime } from '../../../../scripts/platform/demo-config.mjs';
import {
  DocumentPagesService, inspectPrivateDocumentPages, type DocumentPageAuthority,
} from '../../../../packages/server/src/modules/usp/ingestion/document-pages';
import {
  inspectPrivatePacketRegion, packetRegionRecipeSha,
} from '../../../../packages/server/src/modules/usp/packets/region-runtime';
import { PacketRegionService } from '../../../../packages/server/src/modules/usp/packets/region-extract';
import { PacketRegionSelectionSchema } from '../../../../packages/contracts/src/packet-region';

const source = 'E:/BhuAayam-data/datasets/rera-storeys/haryana-2831/haryana-2831-tower3-plan1.pdf';
const expectedHash = '2b9f8803e179c515a694d046ba9c9e5394a79af59e3db75c1748c41fad04c865';
const sourceId = '5293cd72-2377-4deb-a51c-c76d11ccb429';
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

async function save(file: string, value: unknown) {
  await writeFile(file, JSON.stringify(value) + '\n', { flag: 'wx', mode: 0o600 });
}

async function inspectPages(authority: DocumentPageAuthority, bytes: Buffer, output: string) {
  let execution: unknown;
  const service = new DocumentPagesService({
    authorize: async () => authority,
    original: async () => bytes,
    inspect: async (...args) => {
      const inspected = await inspectPrivateDocumentPages(...args);
      execution = inspected.execution;
      return inspected;
    },
  });
  const metadata = await service.pages(sourceId, { revision: '1', sha256: expectedHash, offset: '0', limit: '1' });
  assert.equal(metadata.pages[0].frame.width, 2586);
  assert.equal(metadata.pages[0].frame.height, 1695);
  assert.equal(metadata.pages[0].renderSupport, 'unsupported');
  assert.equal(metadata.pages[0].url, null);
  await save(join(output, 'pages.json'), metadata);
  await save(join(output, 'pages-execution.json'), execution);
  return metadata.pages[0];
}

async function extractRegions(authority: DocumentPageAuthority, bytes: Buffer,
  page: Awaited<ReturnType<typeof inspectPages>>, output: string) {
  const service = new PacketRegionService({
    authorize: async () => authority, original: async () => bytes,
    inspect: inspectPrivatePacketRegion, recipe: packetRegionRecipeSha,
  });
  const crops = [];
  for (const [name, region] of [
    ['floor-caption', [850, 875, 1020, 910]], ['unit-3b-label', [596, 390, 644, 409]],
  ] as const) {
    const selection = PacketRegionSelectionSchema.parse({
      frame: page.frame, mediaBox: page.mediaBox, cropBox: page.cropBox, boxConvention: page.boxConvention,
      coordinates: 'displayed_cropbox_normalized_top_left/1', selectionAcknowledged: true,
      region: region.map((value, index) => value / (index % 2 === 0 ? page.frame.width : page.frame.height)),
    });
    const result = await service.extract(sourceId, 1, {
      revision: '1', sha256: expectedHash, purpose: 'private_source_preview', selection,
    });
    const file = join(output, `${name}.png`);
    await writeFile(file, result.bytes, { flag: 'wx', mode: 0o600 });
    await save(join(output, `${name}-provenance.json`), result.provenance);
    crops.push({ name, regionPt: region, file, ...result.provenance.output, transform: result.provenance.transform });
  }
  return crops;
}

async function main() {
  const [pathsFile, output] = process.argv.slice(2);
  assert.ok(pathsFile && output && isAbsolute(pathsFile) && isAbsolute(output));
  assert.ok(resolve(output).startsWith(resolve('E:/BhuAayam-data/task-data/k4d') + '\\'));
  Object.assign(process.env, readDemoDocumentRuntime(pathsFile));
  await mkdir(output, { mode: 0o700 });
  const bytes = await readFile(source);
  assert.equal(sha256(bytes), expectedHash);
  // Historical ids and a technical case revision bind only this local transport double, not current SQL authority.
  const authority: DocumentPageAuthority = {
    caseId: 'fef196d1-351e-41d7-a31e-aba54424f93f', caseRevision: 1, sourceId, sourceRevision: 1,
    sourceSha256: expectedHash, sourceBytes: bytes.length, objectKey: 'offline-local-transport',
    name: 'Tower 3 plan1 retained original', authoritySha256: sha256(Buffer.from('offline-transport-only')),
  };
  const page = await inspectPages(authority, bytes, output);
  const crops = await extractRegions(authority, bytes, page, output);
  assert.equal(sha256(await readFile(source)), expectedHash);
  const scratch = [process.env.ULPIN_DOCUMENT_PAGES_SCRATCH!, process.env.ULPIN_PACKET_REGIONS_SCRATCH!];
  for (const directory of scratch) assert.deepEqual(await readdir(directory), []);
  await save(join(output, 'result.json'), {
    scope: 'offline_native_runtime; local_authority_and_storage_doubles', source, sha256: expectedHash,
    bytes: bytes.length, page: 1, frame: page.frame, fullPageRender: page.renderSupport,
    recipeSha256: await packetRegionRecipeSha(), crops, scratchEmpty: true,
    runtimeWrites: 0, databaseQueries: 0, apiCalls: 0, modelCalls: 0,
  });
  console.log('Native page metadata and two selected regions passed; source unchanged and owned scratch empty.');
}

main().catch(error => {
  console.error(error.code ?? error.name, error.message);
  process.exitCode = 1;
});
