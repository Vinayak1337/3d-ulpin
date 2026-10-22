import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { RegistryRecordEvidenceSchema } from '../../packages/contracts/src/registry-record-evidence';
import { UspPropertyCardVerificationSchema } from '../../packages/contracts/src/usp/property-card';
import { IntakeTargetPageSchema, type IntakeTarget } from '../../packages/contracts/src/usp/intake';
import { batchData, requireManifest, type BatchContext } from './context';
import { check, object, UnavailableRead } from './read';

const verificationRoute = '/api/v1/usp/property-cards/{cardId}/revisions/{revision}/verification';
const pdfRoute = '/api/v1/usp/property-cards/{cardId}/revisions/{revision}';
const citationRoute = '/api/v1/registry-records/{recordId}/revisions/{revision}/document-citations';
const targetsRoute = '/api/v1/ingestion/cases/{caseId}/targets';

async function newestCarriedTarget(context: BatchContext): Promise<IntakeTarget> {
  const { caseId } = requireManifest(context);
  const targets: IntakeTarget[] = [];
  let cursor: string | undefined;
  const seen = new Set<string>();
  do {
    const query: Record<string, string> = { readiness: 'carded' };
    if (cursor) query.cursor = cursor;
    const read = await context.reader.get(targetsRoute, { caseId }, query);
    const page = IntakeTargetPageSchema.parse(batchData(read));
    assert.equal(page.caseId, caseId);
    assert(page.items.every(target => target.caseId === caseId && target.readiness === 'carded'),
      'Target page changed its case or readiness selection');
    targets.push(...page.items);
    cursor = page.nextCursor ?? undefined;
    assert(!cursor || !seen.has(cursor), 'Target pagination did not advance');
    if (cursor) seen.add(cursor);
    if (seen.size >= 100) {
      throw new UnavailableRead('Target page bound reached; newest target not proven.', 'undecidable');
    }
  } while (cursor);
  if (!targets.length) throw new UnavailableRead('No carried building has a stored card yet.', 'skipped');
  targets.sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  return targets[0];
}

export function batchCard(context: BatchContext) {
  return check(context.reader, 'card', 'Newest carried building card is consistent', 'JRN2/GF5', verificationRoute,
    async () => {
      const target = await newestCarriedTarget(context);
      context.target = target;
      const stored = target.artefacts.card;
      if (!stored) throw new UnavailableRead('The carried building has no stored card pin yet.', 'skipped');
      let params = { cardId: stored.id, revision: stored.revision };
      let report = await verification(context, params);
      if (report.lifecycle.latestRevision > params.revision) {
        params = { ...params, revision: report.lifecycle.latestRevision };
        report = await verification(context, params);
      }
      if (report.lifecycle.latestRevision !== params.revision) {
        throw new UnavailableRead('Card advanced during the check; newest revision is not settled.', 'undecidable');
      }
      assert.equal(report.result, 'consistent', 'Stored card verification is inconsistent');
      const usable = report.lifecycle.expired === false && report.lifecycle.revocation === null
        && report.snapshot.state === 'same_revision';
      context.card = { ...params, recordRevision: report.snapshot.cardTargetRevision, usable };
      return { state: usable ? 'pass' : 'undecidable', observed: {
        words: `Newest carried target ${target.targetId}, card revision ${params.revision}: ${report.result}.`,
        targetId: target.targetId, card: params, result: report.result, checks: report.checks,
        lifecycle: report.lifecycle, snapshot: report.snapshot, signature: report.signature,
        selection: 'Newest updated carded target across all target pages; latest revision of its stored card.' } };
    });
}

async function verification(context: BatchContext, params: { cardId: string; revision: number }) {
  const body = object(batchData(await context.reader.get(verificationRoute, params)));
  const report = UspPropertyCardVerificationSchema.parse(body.data);
  assert.deepEqual([report.cardId, report.revision], [params.cardId, params.revision]);
  return report;
}

// Reuse the server's installed PDF reader, without importing its configured services or reading any source bytes.
async function cardText(bytes: Uint8Array): Promise<string> {
  const require = createRequire(new URL('../../packages/server/package.json', import.meta.url));
  const moduleUrl = pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href;
  type Pdf = typeof import('../../packages/server/node_modules/pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await import(moduleUrl) as Pdf;
  const task = pdf.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, disableFontFace: true,
    useWorkerFetch: false, verbosity: 0 });
  try {
    const document = await task.promise;
    assert.equal(document.numPages, 1, 'Card is not a one-page summary');
    const page = await document.getPage(1);
    const content = await page.getTextContent();
    return content.items.map(item => 'str' in item ? item.str : '').join(' ');
  } finally {
    await task.destroy();
  }
}

export function batchCitation(context: BatchContext) {
  return check(context.reader, 'citation', 'Register row excerpt quoted on the card', 'JRN2/GF5', citationRoute,
    async () => {
      const record = context.target?.artefacts.evidence?.record ?? context.target?.artefacts.record;
      if (!record || !context.card) {
        throw new UnavailableRead('No verified carried card and record pin yet.', 'skipped');
      }
      const evidence = RegistryRecordEvidenceSchema.parse(batchData(await context.reader.get(citationRoute,
        { recordId: record.id, revision: context.card.recordRevision })));
      assert.equal(evidence.recordId, record.id);
      assert.equal(evidence.recordRevision, context.card.recordRevision);
      assert.equal(evidence.recordKind, 'building');
      const rows = evidence.citations.flatMap(citation => citation.pin.version === 'registry-table-row-citation/1'
        && citation.pin.excerpt !== undefined ? [citation.pin] : []);
      if (!rows.length) {
        throw new UnavailableRead('No confirmed register row excerpt on this card record yet.', 'skipped');
      }
      const read = await context.reader.get(pdfRoute, { cardId: context.card.cardId, revision: context.card.revision });
      const bytes = batchData(read);
      assert(bytes instanceof Uint8Array, 'Card resolver did not return a PDF');
      assert(bytes.length <= 524288, 'Card exceeds its published byte bound');
      const printed = (await cardText(bytes)).replace(/\s+/g, ' ');
      const matches = quotedRows(context, rows, printed);
      assert(matches.length > 0, 'Card PDF does not quote a confirmed register row excerpt and file');
      return { observed: { words: `${matches.length} register row excerpts found on the exact card PDF.`,
        card: context.card, recordId: record.id, recordRevision: evidence.recordRevision,
        pdfSha256: createHash('sha256').update(bytes).digest('hex'), citations: matches,
        qualification: evidence.qualification } };
    });
}

type Row = Extract<ReturnType<typeof RegistryRecordEvidenceSchema.parse>['citations'][number]['pin'],
  { version: 'registry-table-row-citation/1' }>;

function quotedRows(context: BatchContext, rows: Row[], printed: string) {
  const { caseId, items } = requireManifest(context);
  return rows.flatMap(row => {
    assert.equal(row.row.caseId, caseId, 'Register citation belongs to another batch');
    const record = context.target?.artefacts.record;
    assert.equal(row.target.recordId, record?.id, 'Register citation belongs to another building');
    const confirmed = context.evidence?.confirmations.find(entry =>
      entry.confirmationId === row.confirmation.confirmationId && entry.profileId === row.key.profileId);
    assert(confirmed, 'Register citation has no stored confirmation in this batch evidence read');
    if (confirmed.accepted) assert(confirmed.accepted.includes(row.confirmation.candidateId));
    const item = items.find(item => item.itemId === row.row.itemId && item.sourceId === row.row.sourceId);
    assert(item, 'Cited register source is not a retained batch item');
    if (!row.excerpt) return [];
    const quoted = JSON.stringify(row.excerpt).replaceAll('\u007f', '\\u007f').replace(/\s+/g, ' ');
    const locator = row.row.selection.format === 'csv' ? `CSV logical row ${row.row.sourceRow}`
      : `Sheet ${row.row.window?.sheet ?? row.row.selection.sheet}, row `
        + `${row.row.window?.physicalRow ?? row.row.sourceRow}`;
    if (!printed.includes(`${quoted} (${item.name}, ${locator}).`)) return [];
    return [{ source: item.name, sourceRow: row.row.sourceRow, key: row.key.literal, excerpt: row.excerpt,
      confirmationId: row.confirmation.confirmationId, candidateId: row.confirmation.candidateId }];
  });
}
