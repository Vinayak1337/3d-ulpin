import assert from 'node:assert/strict';
import { IntakeManifestSchema, IntakeEvidencePageSchema } from '../../packages/contracts/src/usp/intake';
import { Reader, UnavailableRead, check, list, object, text, type Step } from './read';
import { batchData, requireManifest, type BatchContext } from './context';
import { batchItems, batchTables, batchSurfaces } from './batch-items';
import { batchCard, batchCitation } from './batch-card';

const batchRoutes = {
  cases: '/api/v1/cases',
  manifest: '/api/v1/ingestion/cases/{caseId}/intake',
  evidence: '/api/v1/ingestion/cases/{caseId}/intake/evidence',
};

async function selectBatch(context: BatchContext) {
  if (context.caseId) {
    const read = await context.reader.get(batchRoutes.manifest, { caseId: context.caseId });
    context.manifest = IntakeManifestSchema.parse(batchData(read));
    assert.equal(context.manifest.caseId, context.caseId);
    return;
  }
  const cases = list(batchData(await context.reader.get(batchRoutes.cases))).map(object);
  const active = cases.filter(row => row.archived === false);
  active.forEach(row => assert(Number.isFinite(Date.parse(text(row.createdAt))), 'Case timestamp unavailable'));
  active.sort((left, right) => Date.parse(text(right.createdAt)) - Date.parse(text(left.createdAt)));
  for (const row of active) {
    const caseId = text(row.id);
    const manifest = IntakeManifestSchema.parse(batchData(await context.reader.get(batchRoutes.manifest, { caseId })));
    assert.equal(manifest.caseId, caseId);
    if (!manifest.items.length) continue;
    context.caseId = caseId;
    context.manifest = manifest;
    return;
  }
  throw new UnavailableRead('No active case has batch intake items yet; empty workspaces are not batches.', 'skipped');
}

function batchExists(context: BatchContext) {
  return check(context.reader, 'batch', 'Latest batch case', 'JRN2/GF5', batchRoutes.manifest, async () => {
    await selectBatch(context);
    const manifest = requireManifest(context);
    return { observed: { words: `Batch ${manifest.caseId}: ${manifest.items.length} retained items.`,
      caseId: manifest.caseId, items: manifest.items.length } };
  });
}

function batchEvidence(context: BatchContext) {
  return check(context.reader, 'evidence', 'Exact-key profiles and coverage', 'JRN2/GF5', batchRoutes.evidence,
    async () => {
      const { caseId } = requireManifest(context);
      const read = await context.reader.get(batchRoutes.evidence, { caseId });
      const page = IntakeEvidencePageSchema.parse(batchData(read));
      assert.equal(page.caseId, caseId);
      context.evidence = page;
      if (!page.profiles.length) throw new UnavailableRead('No evidence key profile has been declared yet.', 'skipped');
      const missing = page.profiles.some(profile => [
        ...profile.input.tables.map(table => table.itemId), ...profile.input.documents,
      ].some(itemId => !page.sources.some(source =>
        source.itemId === itemId && source.profileId === profile.profileId)));
      const incomplete = missing || page.sources.some(source => source.coverage?.state !== 'closed');
      return { state: incomplete ? 'undecidable' : 'pass', observed: {
        words: `${page.profiles.length} key profiles; ${page.sources.length} sources; coverage retained as read.`,
        profiles: page.profiles.map(profile => ({ profileId: profile.profileId, namespace: profile.input.namespace })),
        sources: page.sources.map(source => ({ itemId: source.itemId, profileId: source.profileId,
          coverage: source.coverage })), counts: page.counts, candidatePageTruncated: page.nextCursor !== null } };
    });
}

function batchConfirmation(context: BatchContext) {
  return check(context.reader, 'confirmation', 'Stored evidence confirmation', 'JRN2/GF5', batchRoutes.evidence,
    async () => {
      if (!context.evidence) throw new UnavailableRead('No evidence page was readable.', 'skipped');
      // Read through the reader again so this step carries its own route and response hash (cached, not a write).
      await context.reader.get(batchRoutes.evidence, { caseId: requireManifest(context).caseId });
      const confirmations = context.evidence.confirmations;
      if (!confirmations.length) throw new UnavailableRead('No stored evidence confirmation yet.', 'skipped');
      return { observed: { words: `${confirmations.length} stored evidence confirmations; no confirmation sent.`,
        confirmations } };
    });
}

export async function runBatch(reader: Reader, caseId?: string): Promise<Step[]> {
  const context: BatchContext = { reader, caseId };
  const steps: Step[] = [];
  for (const run of [batchExists, batchItems, batchTables, batchSurfaces, batchEvidence, batchConfirmation,
    batchCard, batchCitation]) steps.push(await run(context));
  return steps;
}
