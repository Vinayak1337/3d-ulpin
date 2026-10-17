/** K4d's native local-file transport, narrowed to the exact K9 label crop; no live authority claim. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readDemoDocumentRuntime } from '../../../../scripts/platform/demo-config.mjs';
import { PacketRegionSelectionSchema } from '../../../../packages/contracts/src/packet-region';
import {
  inspectPrivatePacketRegion, packetRegionRecipeSha,
} from '../../../../packages/server/src/modules/usp/packets/region-runtime';
import type { DocumentPageAuthority } from '../../../../packages/server/src/modules/usp/ingestion/document-pages';

const source = 'E:/BhuAayam-data/datasets/rera-storeys/haryana-2831/haryana-2831-tower3-plan1.pdf';
const expected = '2b9f8803e179c515a694d046ba9c9e5394a79af59e3db75c1748c41fad04c865';
const sourceId = '5293cd72-2377-4deb-a51c-c76d11ccb429';
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

async function main() {
  const [pathsFile, output] = process.argv.slice(2);
  assert.ok(pathsFile && output);
  Object.assign(process.env, readDemoDocumentRuntime(pathsFile));
  await mkdir(output);
  const bytes = await readFile(source);
  assert.equal(sha256(bytes), expected);
  const authority: DocumentPageAuthority = {
    caseId: 'fef196d1-351e-41d7-a31e-aba54424f93f', caseRevision: 1,
    sourceId, sourceRevision: 1, sourceSha256: expected, sourceBytes: bytes.length,
    objectKey: 'offline-local-transport', name: 'Tower 3 retained original',
    authoritySha256: sha256(Buffer.from('offline-transport-only')),
  };
  const selection = PacketRegionSelectionSchema.parse({
    frame: { kind: 'pdf_display_page_top_left_points', width: 2586, height: 1695, rotation: 0 },
    mediaBox: [0, 0, 2586, 1695], cropBox: [0, 0, 2586, 1695], boxConvention: 'pymupdf_page_rectangles/1',
    coordinates: 'displayed_cropbox_normalized_top_left/1', selectionAcknowledged: true,
    region: [596 / 2586, 390 / 1695, 644 / 2586, 409 / 1695],
  });
  const inspected = await inspectPrivatePacketRegion(authority, bytes, 1, selection, Date.now() + 60000);
  await writeFile(join(output, 'region.png'), inspected.png, { flag: 'wx' });
  const result = {
    scope: 'existing native inspector; local-file authority only', regionPt: [596, 390, 644, 409],
    pngSha256: sha256(inspected.png), pngBytes: inspected.png.length,
    profileSha256: await packetRegionRecipeSha(), worker: inspected.result,
  };
  await writeFile(join(output, 'result.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  assert.equal(sha256(await readFile(source)), expected);
  console.log('Existing native region inspector passed; original unchanged.');
}

main().catch(error => {
  console.error(error.code ?? error.name, error.message);
  process.exitCode = 1;
});
