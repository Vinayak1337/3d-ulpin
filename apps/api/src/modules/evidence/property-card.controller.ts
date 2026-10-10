import { Controller, Get, HttpCode, Param, Post, Req, Res, UseFilters, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { UspGeneratePropertyCardSchema, UspListPropertyCardsSchema, UspReadPropertyCardSchema, UspPropertyCardListSchema,
  UspPropertyCardRevocationSchema, UspPropertyCardSchema, UspPropertyCardVerificationSchema, UspPropertyCardViewSchema,
  UspRevokePropertyCardSchema, UspPreviewPropertyCardSchema, UspPropertyCardPreviewSchema }
  from '../../../../../packages/contracts/src/usp/property-card';
import { generatePropertyCard, previewPropertyCard, readPropertyCard, resolvePropertyCard }
  from '@ulpin/server/modules/usp/packets/card-service';
import { listPropertyCards } from '@ulpin/server/modules/usp/packets/card-listing';
import { revokePropertyCard } from '@ulpin/server/modules/usp/packets/card-revocation';
import { verifyPropertyCard } from '@ulpin/server/modules/usp/packets/card-verification';
import { localRequestContext } from '@ulpin/server/modules/usp/principal';
import { requestId } from '../../common/request-context';
import { PrivateSpatialGuard } from '../spatial/private-spatial.guard';
import { EvidenceExceptionFilter, parseUspPath, readUspBody, UspJsonPost, uspEnvelope } from './evidence.http';
import { envelopeSchema } from './evidence.schemas';

/** One exact revision from the path; anything but a positive decimal revision is refused before domain I/O. */
function exactRevision(cardId: string, revision: string) {
  return parseUspPath(UspReadPropertyCardSchema, { cardId,
    revision: /^[1-9]\d{0,9}$/.test(revision) ? Number(revision) : 0 });
}

@ApiTags('USP private exact-revision property cards')
@UseFilters(EvidenceExceptionFilter)
@UseGuards(PrivateSpatialGuard)
@Controller('api/v1/usp/property-cards')
export class PropertyCardController {
  @Post('generate') @HttpCode(200)
  @UspJsonPost('POST_api_v1_usp_property_cards_generate', 'Generate a private one-page summary linked to an executed confirmed text/CSV, required-region, original-image or mixed PDF plan', UspGeneratePropertyCardSchema, UspPropertyCardSchema)
  async generate(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'private, no-store');
    const command = await readUspBody(req, UspGeneratePropertyCardSchema);
    const card = await generatePropertyCard(localRequestContext(requestId(req)), command);
    return uspEnvelope(req, card.scope, card);
  }
  @Post('preview') @HttpCode(200)
  @UspJsonPost('POST_api_v1_usp_property_cards_preview',
    'The rows a card made now from this executed plan would print. '
      + 'A preview is not a card: nothing is stored and it has no id.',
    UspPreviewPropertyCardSchema, UspPropertyCardPreviewSchema)
  async preview(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'private, no-store');
    const command = await readUspBody(req, UspPreviewPropertyCardSchema);
    const preview = await previewPropertyCard(localRequestContext(requestId(req)), command);
    return uspEnvelope(req, preview.scope, preview);
  }
  @Post('read') @HttpCode(200)
  @UspJsonPost('POST_api_v1_usp_property_cards_read', 'Read exact immutable card facts and separate current target revision under current access', UspReadPropertyCardSchema, UspPropertyCardViewSchema)
  async read(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'private, no-store');
    const command = await readUspBody(req, UspReadPropertyCardSchema);
    const view = await readPropertyCard(localRequestContext(requestId(req)), command);
    return uspEnvelope(req, view.card.scope, view);
  }
  @Post('list') @HttpCode(200)
  @UspJsonPost('POST_api_v1_usp_property_cards_list', 'List the card revisions the caller created for one target, newest first, with their lifecycle and no card fact', UspListPropertyCardsSchema, UspPropertyCardListSchema)
  async list(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'private, no-store');
    const command = await readUspBody(req, UspListPropertyCardsSchema);
    const list = await listPropertyCards(localRequestContext(requestId(req)), command);
    return uspEnvelope(req, command.scope, list);
  }
  @Post('revoke') @HttpCode(200)
  @UspJsonPost('POST_api_v1_usp_property_cards_revoke', 'Revoke one exact card revision as its creator; the card row and its PDF stay unchanged and later reads are refused', UspRevokePropertyCardSchema, UspPropertyCardRevocationSchema)
  async revoke(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'private, no-store');
    const command = await readUspBody(req, UspRevokePropertyCardSchema);
    const revocation = await revokePropertyCard(localRequestContext(requestId(req)), command);
    return uspEnvelope(req, revocation.scope, revocation);
  }
  @Get(':cardId/revisions/:revision')
  @ApiOperation({ operationId: 'GET_api_v1_usp_property_cards_cardId_revisions_revision', summary: 'Resolve one exact local-operator card revision; the QR is not an access grant' })
  @ApiParam({ name: 'cardId', schema: { type: 'string', format: 'uuid' } })
  @ApiParam({ name: 'revision', schema: { type: 'string', pattern: '^[1-9][0-9]*$' } })
  @ApiResponse({ status: 200, description: 'Bounded private one-page PDF, at most 512 KiB',
    content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } } })
  @ApiResponse({ status: 403, description: 'Current operator/source access, exact-card expiry or revocation denied' })
  @ApiResponse({ status: 404, description: 'Exact revision unavailable; no latest-revision fallback' })
  async resolve(@Req() req: Request, @Res() res: Response, @Param('cardId') cardId: string, @Param('revision') revision: string) {
    res.setHeader('Cache-Control', 'private, no-store');
    const command = exactRevision(cardId, revision);
    const result = await resolvePropertyCard(localRequestContext(requestId(req)), command);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="property-card-${result.card.cardId}-r${result.card.revision}.pdf"`);
    res.setHeader('Content-Length', String(result.bytes.length));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Artifact-SHA256', result.card.artifact.sha256);
    res.setHeader('X-Card-Revision', String(result.card.revision));
    res.setHeader('X-Current-Target-Revision', String(result.currentTargetRevision));
    res.setHeader('X-Snapshot-State', result.snapshotState);
    res.send(Buffer.from(result.bytes));
  }
  @Get(':cardId/revisions/:revision/verification')
  @ApiOperation({ operationId: 'GET_api_v1_usp_property_cards_cardId_revisions_revision_verification',
    summary: 'Report whether one exact card revision is consistent with its stored hash chain, plan and packet; no signature is assessed' })
  @ApiParam({ name: 'cardId', schema: { type: 'string', format: 'uuid' } })
  @ApiParam({ name: 'revision', schema: { type: 'string', pattern: '^[1-9][0-9]*$' } })
  @ApiResponse({ status: 200, schema: envelopeSchema(UspPropertyCardVerificationSchema),
    description: 'Private consistency report. A failed check, an expired or revoked card and a later revision are reported here, not refused' })
  @ApiResponse({ status: 403, description: 'Current operator/source access denied; the QR is not an access grant' })
  @ApiResponse({ status: 404, description: 'Exact revision unavailable; no latest-revision fallback' })
  async verification(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Param('cardId') cardId: string, @Param('revision') revision: string) {
    res.setHeader('Cache-Control', 'private, no-store');
    const command = exactRevision(cardId, revision);
    const { report, scope } = await verifyPropertyCard(localRequestContext(requestId(req)), command);
    return uspEnvelope(req, scope, report);
  }
}
