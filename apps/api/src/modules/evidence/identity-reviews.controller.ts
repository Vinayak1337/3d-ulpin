import { Controller, Get, Header, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import { UspIdentityReviewListSchema } from '@ulpin/contracts/usp';
import { listIdentityReviews } from '@ulpin/server/modules/usp/identity-reviews';
import { localRequestContext } from '@ulpin/server/modules/usp/principal';
import { requestId } from '../../common/request-context';
import { ApiContract, requestSchema } from '../register/documentation';
import { PrivateSpatialGuard } from '../spatial/private-spatial.guard';

/** Absent, or one plain decimal. A repeated or malformed value is refused; the contract bounds it to 1-20. */
const LimitQuerySchema = z.string().regex(/^[1-9][0-9]?$/).transform(Number).optional();

/**
 * A listing shaped like the building snapshot list: a plain object under the global error body, not the USP
 * envelope of the identity writes. The caller context is the local operator's, built as those writes build it.
 */
@ApiTags('USP proposals and project identity')
@UseGuards(PrivateSpatialGuard)
@Controller('api/v1/usp/identity/records')
export class IdentityReviewsController {
  @Get(':recordId/reviews')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    operationId: 'GET_api_v1_usp_identity_records_recordId_reviews',
    summary: 'List the identity reviews that name a record and that the local operator may read, newest first',
    description: 'Each item carries the scope the review is bound to, to pass unchanged to the assignment with '
      + 'the item\'s expectedManifestId, reviewId and expectedRecordVersion. used is null until an assignment or '
      + 'mutation has consumed the review; a used review cannot be used again. Order is the time the review was '
      + 'stored (createdAt), newest first, then the id. The evidence a review cites, its location and its '
      + 'reviewer are not answered, and the cited documents are not checked here: the assignment applies its '
      + 'own checks.',
  })
  @ApiParam({ name: 'recordId', schema: { type: 'string', format: 'uuid' } })
  @ApiQuery({ name: 'limit', required: false, schema: { type: 'integer', minimum: 1, maximum: 20, default: 5 } })
  @ApiContract(200, requestSchema(UspIdentityReviewListSchema))
  list(@Param('recordId') recordId: string, @Query('limit') limit: unknown, @Req() request: Request) {
    const ctx = localRequestContext(requestId(request));
    return listIdentityReviews(ctx, { recordId, limit: LimitQuerySchema.parse(limit) });
  }
}
