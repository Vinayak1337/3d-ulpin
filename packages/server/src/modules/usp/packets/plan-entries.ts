import type { RequestContext } from '@ulpin/contracts/usp';
import { PACKET_PDF_RECIPE, UspReadPacketPlanEntriesSchema, UspPacketPlanEntriesSchema,
  type PdfPacketPlanInput } from '../../../../../contracts/src/usp/packet-pdf';
import { transaction } from '../../../infrastructure/db';
import { AppError } from '../../../infrastructure/errors';
import { assertLocalUsp } from '../snapshots';
import { assessPdfPlanTx, protectPdfPlanTx } from './pdf-authority';
import { isSourceStatedTarget, sourceStatementHandle, statementContextTx } from './source-stated-binding';

/** Pure POST read like property-cards/list. The one source-statement entry is returned in record order.
 * No page/crop I/O: inclusion still needs plan create's native page and crop validation. */
export async function readPacketPlanEntries(ctx: RequestContext, raw: unknown) {
  assertLocalUsp(ctx);
  const command = UspReadPacketPlanEntriesSchema.parse(raw);
  const bindingId = sourceStatementHandle(command.target);
  // Internal assessment input only: no plan, receipt, client reason or expiry is stored or answered.
  const input: PdfPacketPlanInput = { ...command, purpose: 'record_evidence', format: 'pdf',
    recipe: PACKET_PDF_RECIPE, expiresAt: new Date(Date.now() + 3600000).toISOString(),
    entries: [{ bindingId, required: true, inclusionReason: 'Read recorded plan entry' }] };
  return transaction(async client => {
    const { target } = await protectPdfPlanTx(client, ctx, input);
    if (!isSourceStatedTarget(target)) {
      throw new AppError(422, 'PACKET_PLAN_ENTRIES_SOURCE_ONLY',
        'Entry discovery currently supports recorded source-stated units only.');
    }
    const { record } = await statementContextTx(client, ctx, input);
    // Reuse exact-current plan assessment: scope, membership, target history and identity must still agree.
    await assessPdfPlanTx(client, ctx, input);
    const evidence = record.sourceOnly.evidence;
    return UspPacketPlanEntriesSchema.parse({ target: command.target, entries: [{
      bindingId, kind: 'source_statement', label: record.name,
      citation: { sourceId: evidence.sourceId, revision: evidence.sourceRevision,
        locator: record.evidence[0].locator, page: evidence.page, region: evidence.region },
      includable: true, reasonCode: null,
    }] });
  });
}
