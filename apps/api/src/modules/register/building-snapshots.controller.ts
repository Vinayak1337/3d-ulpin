import { Controller, Get, Header, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import { UspBuildingSnapshotListSchema } from '@ulpin/contracts/usp';
import { listBuildingSnapshots } from '@ulpin/server/modules/usp/building-snapshots';
import { localRequestContext } from '@ulpin/server/modules/usp/principal';
import { requestId } from '../../common/request-context';
import { PrivateSpatialGuard } from '../spatial/private-spatial.guard';
import { ApiContract, requestSchema } from './documentation';

/** Absent, or one plain decimal. A repeated or malformed value is refused; the contract bounds it to 1-20. */
const LimitQuerySchema = z.string().regex(/^[1-9][0-9]?$/).transform(Number).optional();

/**
 * A building read, so it answers beside the ledger with the same error body. The caller context is the local
 * operator's, built as the USP routes build it, because the list applies the manifest checks of a USP read.
 */
@ApiTags('officer')
@UseGuards(PrivateSpatialGuard)
@Controller('api/v1/buildings')
export class BuildingSnapshotsController {
  @Get(':buildingId/snapshots')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    operationId: 'GET_api_v1_buildings_buildingId_snapshots',
    summary: 'List the recorded snapshots that hold a building and that the local operator may read, newest first',
    description: 'Each item carries the scope its manifest stores, to pass unchanged to the USP reads. '
      + 'Order is the only statement about recency. Cited documents are not checked here: '
      + 'a read that is given a listed scope applies its own document checks.',
  })
  @ApiParam({ name: 'buildingId', schema: { type: 'string', format: 'uuid' } })
  @ApiQuery({ name: 'limit', required: false, schema: { type: 'integer', minimum: 1, maximum: 20, default: 5 } })
  @ApiContract(200, requestSchema(UspBuildingSnapshotListSchema))
  list(@Param('buildingId') buildingId: string, @Query('limit') limit: unknown, @Req() request: Request) {
    const ctx = localRequestContext(requestId(request));
    return listBuildingSnapshots(ctx, { buildingId, limit: LimitQuerySchema.parse(limit) });
  }
}
