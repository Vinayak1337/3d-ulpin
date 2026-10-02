import { Controller, Get, HttpCode, Param, Post, Req, Res, UseFilters, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { UspGeneratePropertyCardSchema, UspReadPropertyCardSchema, UspPropertyCardSchema,
  UspPropertyCardViewSchema } from '../../../../../packages/contracts/src/usp/property-card';
import { generatePropertyCard, readPropertyCard, resolvePropertyCard } from '@ulpin/server/modules/usp/packets/card-service';
import { localRequestContext } from '@ulpin/server/modules/usp/principal';
import { requestId } from '../../common/request-context';
import { PrivateSpatialGuard } from '../spatial/private-spatial.guard';
import { EvidenceExceptionFilter, parseUspPath, readUspBody, UspJsonPost, uspEnvelope } from './evidence.http';

@ApiTags('USP private exact-revision property cards')
@UseFilters(EvidenceExceptionFilter)
@UseGuards(PrivateSpatialGuard)
@Controller('api/v1/usp/property-cards')
export class PropertyCardController {
  @Post('generate') @HttpCode(200)
  @UspJsonPost('POST_api_v1_usp_property_cards_generate', 'Generate a private one-page summary linked to an executed confirmed text/CSV or one-region PDF plan', UspGeneratePropertyCardSchema, UspPropertyCardSchema)
  async generate(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'private, no-store');
    const command = await readUspBody(req, UspGeneratePropertyCardSchema);
    const card = await generatePropertyCard(localRequestContext(requestId(req)), command);
    return uspEnvelope(req, card.scope, card);
  }
  @Post('read') @HttpCode(200)
  @UspJsonPost('POST_api_v1_usp_property_cards_read', 'Read exact immutable card facts and separate current target revision under current access', UspReadPropertyCardSchema, UspPropertyCardViewSchema)
  async read(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'private, no-store');
    const command = await readUspBody(req, UspReadPropertyCardSchema);
    const view = await readPropertyCard(localRequestContext(requestId(req)), command);
    return uspEnvelope(req, view.card.scope, view);
  }
  @Get(':cardId/revisions/:revision')
  @ApiOperation({ operationId: 'GET_api_v1_usp_property_cards_cardId_revisions_revision', summary: 'Resolve one exact local-operator card revision; the QR is not an access grant' })
  @ApiParam({ name: 'cardId', schema: { type: 'string', format: 'uuid' } })
  @ApiParam({ name: 'revision', schema: { type: 'string', pattern: '^[1-9][0-9]*$' } })
  @ApiResponse({ status: 200, description: 'Bounded private one-page PDF, at most 512 KiB',
    content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } } })
  @ApiResponse({ status: 403, description: 'Current operator/source access or exact-card expiry denied' })
  @ApiResponse({ status: 404, description: 'Exact revision unavailable; no latest-revision fallback' })
  async resolve(@Req() req: Request, @Res() res: Response, @Param('cardId') cardId: string, @Param('revision') revision: string) {
    res.setHeader('Cache-Control', 'private, no-store');
    const command = parseUspPath(UspReadPropertyCardSchema, { cardId,
      revision: /^[1-9]\d{0,9}$/.test(revision) ? Number(revision) : 0 });
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
}
