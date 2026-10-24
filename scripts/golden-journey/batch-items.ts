import assert from 'node:assert/strict';
import { IntakeSurfacePartPageSchema, IntakeSurfaceDisplaySchema,
  type IntakeSurfacePart } from '../../packages/contracts/src/usp/intake';
import { AnySourceProfileSchema } from '../../packages/contracts/src/usp/ingestion';
import { check, UnavailableRead } from './read';
import { batchData, requireManifest, type BatchContext, type Manifest } from './context';

type Item = Manifest['items'][number];
const profileRoute = '/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/profile';
const partsRoute = '/api/v1/ingestion/cases/{caseId}/intake/items/{itemId}/parts';
const displayRoute = partsRoute + '/{partIndex}/display';

export function batchItems(context: BatchContext) {
  return check(context.reader, 'items', 'Retained items and reading state', 'JRN2/GF5',
    '/api/v1/ingestion/cases/{caseId}/intake', async () => {
      const manifest = requireManifest(context);
      assert(manifest.items.every(item => item.caseId === manifest.caseId), 'Manifest item belongs to another case');
      await context.reader.get('/api/v1/ingestion/cases/{caseId}/intake', { caseId: manifest.caseId });
      if (!manifest.items.length) throw new UnavailableRead('This case has no retained intake items yet.', 'skipped');
      const failed = manifest.items.some(item => ['failed_part', 'probe_failed'].includes(item.state));
      return { state: failed ? 'fail' : 'pass', observed: {
        words: `${manifest.items.length} items; reading states reported without replacing unknown counts.`,
        items: manifest.items.map(item => ({ itemId: item.itemId, name: item.name, family: item.family,
          format: item.format, state: item.state, placement: item.placement, partsPlanned: item.partsPlanned,
          partsDone: item.partsDone, recordsSeen: item.recordsSeen, words: item.limitReason })) } };
    });
}

export function batchTables(context: BatchContext) {
  return check(context.reader, 'table', 'Register table read', 'JRN2/GF5', profileRoute, async () => {
    const items = requireManifest(context).items.filter(item => item.family === 'table');
    if (!items.length) throw new UnavailableRead('No table item in this batch yet.', 'skipped');
    const tables = [];
    for (const item of items) {
      if (!item.sourceId) {
        tables.push({ itemId: item.itemId, state: item.state, records: null, words: 'No retained table source yet.' });
        continue;
      }
      const read = await context.reader.get(profileRoute, { caseId: item.caseId, sourceId: item.sourceId });
      if (read.status === 404) {
        tables.push({ itemId: item.itemId, state: item.state, records: null, words: 'Table not read yet.' });
        continue;
      }
      const profile = AnySourceProfileSchema.parse(batchData(read));
      assert.equal(profile.caseId, item.caseId);
      assert.equal(profile.source.sourceId, item.sourceId);
      assert(profile.version === 'manual-tabular/1', 'Table item returned a non-table profile');
      tables.push({ itemId: item.itemId, state: item.state, records: profile.records, columns: profile.headers.length,
        words: `Table read: ${profile.records} records, ${profile.headers.length} columns.` });
    }
    const read = tables.filter(table => table.records !== null).length;
    let state: 'pass' | 'skipped' | 'undecidable' = 'pass';
    if (read < tables.length) state = 'undecidable';
    if (read === 0) state = 'skipped';
    return { state, observed: {
      words: `${read} of ${tables.length} tables have a stored reading; unread counts stay null.`, tables } };
  });
}

async function surfaceParts(context: BatchContext, item: Item): Promise<IntakeSurfacePart[]> {
  const parts: IntakeSurfacePart[] = [];
  let after = -1;
  for (let pageIndex = 0; pageIndex < 100; pageIndex++) {
    const page = IntakeSurfacePartPageSchema.parse(batchData(await context.reader.get(partsRoute,
      { caseId: item.caseId, itemId: item.itemId }, { after })));
    assert.equal(page.caseId, item.caseId);
    assert.equal(page.itemId, item.itemId);
    for (const part of page.parts) {
      assert(part.partIndex > (parts.at(-1)?.partIndex ?? -1), 'Surface parts not strictly increasing');
      parts.push(part);
    }
    if (page.next === null) return parts;
    assert(page.next > after, 'Surface pagination did not advance');
    after = page.next;
  }
  throw new UnavailableRead('Surface page bound reached; counts are incomplete.', 'undecidable');
}

async function surfaceState(context: BatchContext, item: Item) {
  const parts = await surfaceParts(context, item);
  const counts = { published: 0, placed: 0, notPlaced: 0, pending: 0, quarantined: 0 };
  const reasons: Record<string, number> = {};
  for (const part of parts) {
    if (part.state !== 'published') {
      if (part.state === 'quarantined') counts.quarantined++;
      else counts.pending++;
      continue;
    }
    const display = IntakeSurfaceDisplaySchema.parse(batchData(await context.reader.get(displayRoute,
      { caseId: item.caseId, itemId: item.itemId, partIndex: part.partIndex })));
    assert.deepEqual([display.caseId, display.itemId, display.partIndex], [item.caseId, item.itemId, part.partIndex]);
    assert.equal(display.resultSha256, part.resultSha256, 'Display is not the published part result');
    counts.published++;
    if (display.placement.state === 'placed') counts.placed++;
    else {
      counts.notPlaced++;
      const reason = display.placement.words;
      reasons[reason] = (reasons[reason] ?? 0) + 1;
    }
  }
  return { itemId: item.itemId, name: item.name, planned: item.partsPlanned, ...counts, reasons,
    words: `${counts.placed} placed, ${counts.notPlaced} not placed, ${counts.pending} pending; display only.` };
}

export function batchSurfaces(context: BatchContext) {
  return check(context.reader, 'surfaces', 'Surface parts placed or not placed', 'JRN2/GF5', displayRoute, async () => {
    const items = requireManifest(context).items.filter(item => ['raster', 'point_cloud'].includes(item.family));
    if (!items.length) throw new UnavailableRead('No surface item in this batch yet.', 'skipped');
    const surfaces = [];
    for (const item of items) surfaces.push(await surfaceState(context, item));
    const failed = surfaces.some(surface => surface.quarantined > 0);
    const published = surfaces.reduce((total, surface) => total + surface.published, 0);
    let state: 'pass' | 'fail' | 'skipped' = published ? 'pass' : 'skipped';
    if (failed) state = 'fail';
    const words = published ? `${published} published surface parts read; placement is not measurement.`
      : 'No published surface parts to display yet; pending counts and unknown planned counts retained.';
    return { state, observed: { words, surfaces } };
  });
}
