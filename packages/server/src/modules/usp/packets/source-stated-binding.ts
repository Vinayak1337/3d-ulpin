import type { PoolClient } from 'pg';
import { SourceStatedRecordSchema, RegistryRegionCitationSchema, type RegistryRegionCitation,
  type SourceStatedRecord } from '@ulpin/contracts';
import { DocumentPagesSchema } from '../../../../../contracts/src/document-pages';
import { PacketRegionSelectionSchema } from '../../../../../contracts/src/packet-region';
import { PACKET_PDF_RECIPE, type AnyPdfPacketPlanInput } from '../../../../../contracts/src/usp/packet-pdf';
import type { RequestContext, TargetPin } from '@ulpin/contracts/usp';
import { transaction } from '../../../infrastructure/db';
import { AppError, conflict } from '../../../infrastructure/errors';
import { canonical, fingerprint } from '../../cases/domain';
import { scopedManifestTx } from '../commands';
import { assertLocalUsp } from '../snapshots';
import { DocumentPagesService } from '../ingestion/document-pages';
import { prepareRegistryRegion, registryRegionSourceTx, regionCitationId,
} from '../../registry/registry-region-evidence';
import type { PdfPacketIo } from './pdf-service';

type SnapshotTarget = { id: string; site_id: string; kind: string; revision: number; body: any };
type Evidence = SourceStatedRecord['sourceOnly']['evidence'];

const denied = () => new AppError(422, 'PACKET_SOURCE_STATEMENT',
  'Select only the exact recorded source-only citation.');
const pagesService = new DocumentPagesService();

/** Entry handle only, derived from the real recorded pin; the bound citation keeps its ordinary integrity id. */
export function sourceStatementHandle(target: TargetPin): string {
  return fingerprint({ version: 'source-stated-space/1', target });
}

export function isSourceStatedTarget(target: SnapshotTarget): boolean {
  return target.kind === 'space' && Boolean(target.body?.sourceOnly);
}

async function snapshotMemberTx(client: PoolClient, ctx: RequestContext, input: AnyPdfPacketPlanInput, pin: TargetPin) {
  const manifest = await scopedManifestTx(client, ctx, input.scope);
  const member = manifest.members.find(item => canonical(item.pin) === canonical(pin));
  const row = (await client.query(`SELECT body,body_sha256 FROM usp_snapshot_bodies WHERE manifest_id=$1
    AND namespace=$2 AND object_id=$3 AND revision=$4`,
  [input.scope.manifestId, pin.ref.namespace, pin.ref.id, pin.revision])).rows[0];
  if (!member || !row || row.body_sha256 !== fingerprint(row.body) || member.bodySha256 !== row.body_sha256
    || member.bodyRef !== fingerprint([pin.ref.namespace, pin.ref.id, pin.revision, row.body])) {
    conflict('The exact source-statement snapshot member is unavailable.');
  }
  return row.body;
}

function statementRecord(target: SnapshotTarget, input: AnyPdfPacketPlanInput): SourceStatedRecord {
  const record = SourceStatedRecordSchema.safeParse({ ...target.body, revision: target.revision });
  if (!record.success || record.data.kind !== 'space' || record.data.id !== target.id
    || target.id !== input.target.ref.id || target.revision !== input.target.revision
    || target.site_id !== input.scope.scopeId || record.data.siteId !== target.site_id
    || input.recipe !== PACKET_PDF_RECIPE || input.entries.length !== 1) throw denied();
  return record.data;
}

/** The cited original must be the very revision and hash captured in the same snapshot. */
async function capturedOriginalTx(client: PoolClient, ctx: RequestContext, input: AnyPdfPacketPlanInput,
  evidence: Evidence) {
  const source = await snapshotMemberTx(client, ctx, input, {
    ref: { namespace: 'source_revision', id: evidence.sourceId }, revision: evidence.sourceRevision,
  });
  if (source.id !== evidence.sourceId || source.revision !== evidence.sourceRevision
    || source.sha256 !== evidence.sourceSha256) throw denied();
  return source;
}

async function statementContextTx(client: PoolClient, ctx: RequestContext, input: AnyPdfPacketPlanInput) {
  assertLocalUsp(ctx);
  const target = await snapshotMemberTx(client, ctx, input, input.target) as SnapshotTarget;
  const record = statementRecord(target, input);
  const source = await capturedOriginalTx(client, ctx, input, record.sourceOnly.evidence);
  const sourceCase = (await client.query('SELECT revision FROM cases WHERE id=$1', [source.case_id])).rows[0];
  if (!sourceCase) throw denied();
  const original = { caseId: source.case_id, caseRevision: Number(sourceCase.revision), sourceId: source.id,
    sourceRevision: source.revision, sourceSha256: source.sha256, sourceBytes: Number(source.bytes) };
  const authority = await registryRegionSourceTx(client, input.scope.scopeId, original);
  return { target, record, original, authority };
}

function normalizedRegion(evidence: Evidence, frame: { width: number; height: number }) {
  return evidence.region.map((value, index) => value / (index % 2 ? frame.height : frame.width));
}

async function pageSelection(evidence: Evidence, io: PdfPacketIo) {
  const read = io.pages ?? pagesService.pages.bind(pagesService);
  const pages = DocumentPagesSchema.parse(await read(evidence.sourceId, { revision: String(evidence.sourceRevision),
    sha256: evidence.sourceSha256, offset: String(evidence.page - 1), limit: '1' }));
  const page = pages.pages.find(item => item.page === evidence.page);
  if (pages.sourceId !== evidence.sourceId || pages.sourceRevision !== evidence.sourceRevision
    || pages.sourceSha256 !== evidence.sourceSha256 || !page || evidence.page > pages.pageCount
    || evidence.region[2] > page.frame.width || evidence.region[3] > page.frame.height) throw denied();
  return PacketRegionSelectionSchema.parse({ frame: page.frame, mediaBox: page.mediaBox, cropBox: page.cropBox,
    boxConvention: page.boxConvention, coordinates: 'displayed_cropbox_normalized_top_left/1',
    region: normalizedRegion(evidence, page.frame), selectionAcknowledged: true });
}

function citationFor(ctx: RequestContext, context: Awaited<ReturnType<typeof statementContextTx>>,
  region: Awaited<ReturnType<typeof pageSelection>>,
  validation: Awaited<ReturnType<typeof prepareRegistryRegion>>['validation']): RegistryRegionCitation {
  const { target, record, original, authority } = context;
  const body = { document: original, page: record.sourceOnly.evidence.page, region, purpose: 'record_evidence' as const,
    target: { recordId: target.id, revision: target.revision, bodySha256: fingerprint(target.body) }, validation,
    authoritySha256: authority.authority.authoritySha256 };
  return RegistryRegionCitationSchema.parse({ version: 'registry-document-region-citation/1',
    id: regionCitationId(body), ...body, selection: { subject: ctx.principal.subject, accessSha256: authority.accessSha256,
      selectedAt: record.sourceOnly.decision.time },
    applicability: 'explicit_officer_inclusion; effective_after_canonical_commit',
    associationState: 'operator_selected', qualification: 'not_assessed' });
}

/** Native metadata/crop I/O stays outside SQL locks; planning rechecks the exact captured and live authority. */
export async function prepareSourceStatementBindings(ctx: RequestContext, input: AnyPdfPacketPlanInput,
  io: PdfPacketIo): Promise<RegistryRegionCitation[]> {
  if (!input.entries.some(entry => entry.bindingId === sourceStatementHandle(input.target))) return [];
  const context = await transaction(client => statementContextTx(client, ctx, input), undefined,
    'repeatable_read_only');
  const evidence = context.record.sourceOnly.evidence;
  const region = await pageSelection(evidence, io);
  const prepared = await prepareRegistryRegion({ document: context.original, page: evidence.page, region,
    purpose: 'record_evidence' }, context.authority, io.extract);
  return [citationFor(ctx, context, region, prepared.validation)];
}

function assertBindsRecord(binding: RegistryRegionCitation, target: SnapshotTarget, record: SourceStatedRecord,
  source: Record<string, any>) {
  const evidence = record.sourceOnly.evidence;
  if (binding.id !== regionCitationId(binding) || binding.target.recordId !== target.id
    || binding.target.revision !== target.revision || binding.target.bodySha256 !== fingerprint(target.body)
    || binding.document.caseId !== source.case_id || binding.document.sourceId !== source.id
    || binding.document.sourceRevision !== source.revision || binding.document.sourceSha256 !== source.sha256
    || binding.document.sourceBytes !== Number(source.bytes) || binding.page !== evidence.page
    || evidence.region[2] > binding.region.frame.width || evidence.region[3] > binding.region.frame.height
    || canonical(binding.region.region) !== canonical(normalizedRegion(evidence, binding.region.frame))) throw denied();
}

/** The recorded citation stands in for a committed region binding for this one record kind only. */
export async function sourceStatementBindingsTx(client: PoolClient, ctx: RequestContext, input: AnyPdfPacketPlanInput,
  target: SnapshotTarget, supplied: readonly { version: string }[]) {
  const record = statementRecord(target, input);
  const source = await capturedOriginalTx(client, ctx, input, record.sourceOnly.evidence);
  const citations = supplied.filter(item => item.version === 'registry-document-region-citation/1')
    .map(item => RegistryRegionCitationSchema.parse(item));
  return input.entries.map(entry => {
    const binding = entry.bindingId === sourceStatementHandle(input.target)
      ? citations.find(item => item.target.recordId === target.id) : undefined;
    if (binding) assertBindsRecord(binding, target, record, source);
    return binding;
  });
}
