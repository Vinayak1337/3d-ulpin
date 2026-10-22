import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import sharp from 'sharp';
import { INTAKE_PAGE_IMAGE_LIMITS, IntakePageImageReadSchema } from '@ulpin/contracts/usp';
import { sha256 } from '../../../infrastructure/storage';
import { readPageImage, type PageImageDependencies } from './intake-page-image-worker';
import { probeOriginal } from './intake-probe';
import { pageImageFormat, pageImagePreview, pageImageWords, readPageImageHeader } from './page-image-read';

// Real inputs from the data drive (docs/api/datasets.json); each test is skipped where the drive is absent.
const plan = 'E:/BhuAayam-data/datasets/cubicasa5k/p2-test-20261011/high_quality_architectural/123/F1_scaled.png';
const jpeg = 'E:/BhuAayam-data/task-data/desktop-ai04f-docling-tesseract/mamba-root/pkgs/https/conda.anaconda.org/'
  + 'conda-forge/win-64/libjpeg-turbo-3.2.0-hfd05255_1/info/test/testorig.jpg';
const ramp = 'E:/BhuAayam-data/datasets/ramp/originals/ramp_barishal_bangladesh/source/'
  + '0003d02a-6bf0-4790-ac29-eed4337fe430.tif';
const absent = (path: string) => existsSync(path) ? false : `${path} is not on this machine`;
const input = { version: 'intake-page-image/1' as const, jobId: '20000000-0000-4000-8000-000000000001',
  caseId: '20000000-0000-4000-8000-000000000002', caseRevision: 0, itemId: '20000000-0000-4000-8000-000000000003',
  sourceId: '20000000-0000-4000-8000-000000000003', sourceRevision: 1, sourceSha256: 'a'.repeat(64),
  sourcePin: 'b'.repeat(64), subject: 'g23-protocol-operator', accessSha256: 'c'.repeat(64) };
const probe = (bytes: Buffer, name: string) =>
  probeOriginal(async (start, end) => bytes.subarray(start, end), bytes.length, name);

function memory(bytes: Buffer, stored: Map<string, Uint8Array>): PageImageDependencies {
  return { whole: async () => bytes, head: async original => bytes.subarray(0, INTAKE_PAGE_IMAGE_LIMITS.headBytes
    > original.bytes ? original.bytes : INTAKE_PAGE_IMAGE_LIMITS.headBytes),
  store: async (key, value) => { stored.set(key, value); } };
}

test('a real plan PNG is a page image read to its header and a 1,024 px preview pointing to its original',
  { skip: absent(plan) }, async () => {
    const bytes = readFileSync(plan);
    const card = await probe(bytes, 'renamed.bin');
    assert.equal(pageImageFormat(card), 'png', 'recognised by signature, not by name');
    const stored = new Map<string, Uint8Array>();
    const read = await readPageImage({ ...input, sourceSha256: sha256(bytes) },
      { key: 'k', bytes: bytes.length, sha256: sha256(bytes), format: 'png' }, memory(bytes, stored),
      AbortSignal.timeout(30000));
    assert.ok(read);
    assert.deepEqual({ ...read, preview: null }, { version: 'page-image-read/1', format: 'png', width: 2776,
      height: 1346, bands: 3, bitDepth: 8, orientation: null, captureTime: null, locationStated: false, dpi: null,
      preview: null, previewLimit: null, label: null });
    assert.equal(read.preview?.width, 1024);
    assert.equal(read.preview?.height, 497);
    assert.deepEqual(read.preview?.original, { sourceId: input.sourceId, sourceRevision: 1, sha256: sha256(bytes) });
    const preview = stored.get(read.preview!.key)!;
    assert.equal(sha256(preview), read.preview?.sha256);
    assert.equal(read.preview?.key, `page-image-previews/${input.sourceId}/${sha256(preview)}.png`);
    assert.equal(pageImageWords(read), 'A 2,776 x 1,346 PNG image, no location stated. Kept for review as a page '
      + 'image. What does it show: a plan, an elevation, a photo or something else?');
  });

test('a real small JPEG states no density and its preview is never enlarged', { skip: absent(jpeg) }, async () => {
  const bytes = readFileSync(jpeg);
  assert.equal(pageImageFormat(await probe(bytes, 'scan.tif')), 'jpeg');
  const header = readPageImageHeader(bytes, 'jpeg');
  assert.deepEqual([header.width, header.height, header.bands, header.bitDepth, header.dpi],
    [227, 149, 3, 8, null]);
  const preview = await pageImagePreview(bytes);
  assert.deepEqual([preview.width, preview.height, preview.orientationApplied], [227, 149, null]);
});

test('a real georeferenced TIFF stays a raster and never becomes a page image (D4)', { skip: absent(ramp) },
  async () => {
    const bytes = readFileSync(ramp);
    const card = await probe(bytes, 'chip.tif');
    assert.equal(card.family, 'raster');
    assert.equal(pageImageFormat(card), null);
    assert.equal(readPageImageHeader(bytes, 'tiff').georeferenced, true);
    const read = await readPageImage(input, { key: 'k', bytes: bytes.length, sha256: sha256(bytes), format: 'tiff' },
      memory(bytes, new Map()), AbortSignal.timeout(30000));
    assert.equal(read, null, 'a georeference found only by the reader hands it back to the raster route');
  });

// test_only: a camera photo's EXIF orientation and capture time cannot be had from a real file on this drive.
test('a stated EXIF orientation is applied to the preview and its capture time is kept as stated', async () => {
  const bytes = await sharp({ create: { width: 400, height: 300, channels: 3, background: '#7f7f7f' } })
    .withMetadata({ orientation: 6 }).withExif({ IFD2: { DateTimeOriginal: '2026:10:20 11:12:13' } })
    .jpeg().toBuffer();
  const header = readPageImageHeader(bytes, 'jpeg');
  assert.deepEqual([header.width, header.height, header.orientation, header.captureTime, header.locationStated],
    [400, 300, 6, '2026:10:20 11:12:13', false]);
  const preview = await pageImagePreview(bytes);
  assert.deepEqual([preview.width, preview.height, preview.orientationApplied], [300, 400, 6]);
  const { georeferenced, ...facts } = header;
  assert.equal(georeferenced, false);
  const read = IntakePageImageReadSchema.parse({ version: 'page-image-read/1', ...facts, preview: null,
    previewLimit: 'it could not be decoded for a preview', label: null });
  assert.match(pageImageWords(read), /^A 400 x 300 JPEG image, taken 2026:10:20 11:12:13 as its EXIF states, no /);
});

// test_only: an untagged TIFF scan, its IFD written where the encoder puts it.
test('a TIFF without georeference tags is a page image by signature, whatever its name', async () => {
  const bytes = await sharp({ create: { width: 300, height: 200, channels: 3, background: '#ffffff' } })
    .withMetadata({ density: 300 }).tiff().toBuffer();
  const card = await probe(bytes, 'plan.jpg');
  assert.deepEqual([card.family, card.format, pageImageFormat(card)], ['image', 'tiff', 'tiff']);
  const header = readPageImageHeader(bytes, 'tiff');
  assert.deepEqual([header.width, header.height, header.bands, header.dpi],
    [300, 200, 3, { x: 300, y: 300, statedIn: 'tiff' }]);
});

test('above the byte bound only the first bytes are read and the item says why no preview was made', async () => {
  const bytes = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#000000' } }).png()
    .toBuffer();
  const stored = new Map<string, Uint8Array>();
  const read = await readPageImage(input, { key: 'k', bytes: INTAKE_PAGE_IMAGE_LIMITS.originalBytes + 1,
    sha256: input.sourceSha256, format: 'png' }, { ...memory(bytes, stored),
    whole: async () => assert.fail('the whole original is never read above the bound') }, AbortSignal.timeout(5000));
  assert.deepEqual([read?.width, read?.height, read?.preview, stored.size], [64, 48, null, 0]);
  // The encoder states 1 pixel per millimetre in pHYs; it is said back as stated.
  assert.equal(pageImageWords(read!), 'A 64 x 48 PNG image, no location stated, 25.4 DPI as stated. Kept for '
    + 'review as a page image '
    + '(the original is above 128 MiB, so only its first bytes were read and no preview was made). What does it '
    + 'show: a plan, an elevation, a photo or something else?');
  const answered = { ...read!, label: { value: 'plan' as const, state: 'candidate' as const,
    answeredAt: '2026-10-21T00:00:00.000Z' } };
  // No reader in the application takes a plan from a page image: the words say it is kept and not read.
  assert.ok(pageImageWords(answered).endsWith('it shows a plan; this is a candidate label, not reviewed. It is kept '
    + 'as a labelled plan image and is not read: no plan reader in a batch takes a page image yet, so no text, '
    + 'rooms, levels or units come from it.'));
  const photo = { ...answered, label: { ...answered.label, value: 'photo' as const } };
  assert.ok(pageImageWords(photo).endsWith('it shows a photo; this is a candidate label, not reviewed. It is kept '
    + 'as a labelled page image and is not read.'));
});
