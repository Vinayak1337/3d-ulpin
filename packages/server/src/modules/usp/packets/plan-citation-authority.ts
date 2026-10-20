import type { PoolClient } from 'pg';
import { RegistryDocumentCitationsSchema, type RegistryNativeDocumentCitation,
  type RegistryTableRowCitation } from '@ulpin/contracts';
import { DocumentInputSchema } from '@ulpin/contracts/usp';
import { AppError, conflict } from '../../../infrastructure/errors';
import { fingerprint } from '../../cases/domain';
import { citedRowIndex, tableRowExcerpt, tableRowLocatorWords } from '../../registry/registry-table-evidence';
import { readDocumentResult } from '../ingestion/documents';
import { readTabularSource } from '../ingestion/tabular-source';

/**
 * AU4-B3 D4: the citations an officer confirmed by an exact key, as plan bindings. Each names its source, the
 * locator in words and the excerpt exactly as stored on the cited record; the plan reads the original or the
 * accepted extraction again and refuses an excerpt that is not byte-exact.
 */
export const EVIDENCE_CITATION_LIMIT = 10;
export const EVIDENCE_CITATION_LINE = 'Evidence confirmed by the officer by an exact key; it states no right or owner.';
type Citation = RegistryTableRowCitation | (RegistryNativeDocumentCitation & {
  evidence: NonNullable<RegistryNativeDocumentCitation['evidence']> });
export type EvidenceBinding = { sourceId: string; sourceRevision: number; locator: string; excerpt: string;
  citation: Citation };

function binding(pin: Citation): EvidenceBinding {
  if (pin.version === 'registry-table-row-citation/1') {
    return { sourceId: pin.row.sourceId, sourceRevision: pin.row.sourceRevision,
      locator: tableRowLocatorWords(pin.row), excerpt: pin.excerpt!, citation: pin };
  }
  const { quote, quoteStart, quoteEnd } = pin.evidence;
  return { sourceId: pin.document.sourceId, sourceRevision: pin.document.sourceRevision,
    locator: `${pin.locator.label}, characters ${quoteStart + 1} to ${quoteEnd}`, excerpt: quote, citation: pin };
}

/** The record's confirmed evidence citations, one binding per source and locator, in citation order. */
export function evidenceCitationBindings(body: { documentCitations?: unknown } | undefined): EvidenceBinding[] {
  const cited = RegistryDocumentCitationsSchema.parse(body?.documentCitations ?? []);
  const confirmed = cited.filter((pin): pin is Citation =>
    pin.version === 'registry-table-row-citation/1' ? pin.excerpt !== undefined
      : pin.version === 'registry-document-citation/1' && pin.evidence !== undefined);
  const bindings = new Map(confirmed.map(binding).reverse().map(item => [`${item.sourceId}\n${item.locator}`, item]));
  const unique = [...bindings.values()].reverse();
  if (unique.length > EVIDENCE_CITATION_LIMIT) {
    throw new AppError(413, 'PACKET_PLAN_EVIDENCE_LIMIT', `A card quotes at most ${EVIDENCE_CITATION_LIMIT} `
      + `confirmed citations; this record holds ${unique.length}.`);
  }
  return unique;
}

/** The table row read again from the verified original bytes; its excerpt must be exactly the stored one. */
function tableExcerpt(pin: RegistryTableRowCitation, bytes: Uint8Array) {
  const table = readTabularSource(bytes, pin.row.selection);
  if (fingerprint(table) !== pin.row.rawResultSha256) conflict('The cited table no longer reads as it was accepted.');
  const index = citedRowIndex(table, pin.row);
  if (tableRowExcerpt(table, index, pin.row.columnIndex) !== pin.excerpt) conflict('The cited row excerpt changed.');
  return pin.excerpt!;
}

/** The quote read again from the accepted extraction of that source revision; a mismatch refuses. */
async function documentExcerptTx(client: PoolClient, pin: Extract<Citation, { partId: string }>,
  read: typeof readDocumentResult) {
  const job = (await client.query(`SELECT j.payload,m.accepted_fence FROM jobs j
    LEFT JOIN usp_job_metadata m ON m.job_id=j.id WHERE j.id=$1 AND j.operation='document-extraction'`,
  [pin.document.jobId])).rows[0];
  const input = job && DocumentInputSchema.parse(job.payload);
  if (!input || fingerprint(input) !== pin.inputSha256 || Number(job.accepted_fence) !== pin.acceptedFence) {
    conflict('The accepted extraction of the cited part changed.');
  }
  const part = (await read(input, pin.document.resultSha256)).native.parts.find(item => item.id === pin.partId);
  const { quote, quoteStart, quoteEnd } = pin.evidence;
  if (!part || part.sha256 !== pin.partSha256 || part.text.slice(quoteStart, quoteEnd) !== quote) {
    conflict('The confirmed quote is not the exact text of its accepted part.');
  }
  return quote;
}

/** The exact excerpt of one confirmed citation, from the original bytes the plan already verified. */
export async function evidenceExcerptTx(client: PoolClient, cited: EvidenceBinding, bytes: Uint8Array,
  read: typeof readDocumentResult = readDocumentResult) {
  const pin = cited.citation;
  return pin.version === 'registry-table-row-citation/1' ? tableExcerpt(pin, bytes)
    : documentExcerptTx(client, pin, read);
}

/** One card line per citation: the excerpt quoted exactly (JSON string escapes keep it on one line and reversible),
 * the file name, the locator in words and the officer line. */
export function evidenceCardValue(excerpt: string, fileName: string, locator: string) {
  const quoted = JSON.stringify(excerpt).replaceAll('\u007f', '\\u007f');
  return `${quoted} (${fileName}, ${locator}). ${EVIDENCE_CITATION_LINE}`;
}
