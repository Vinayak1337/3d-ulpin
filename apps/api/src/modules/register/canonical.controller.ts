import { Controller, Get, Inject, Param, Query, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { NormalizedAreaSchema, NormalizedBuildingSchema } from '@ulpin/contracts';
import { CanonicalProjectionService } from './canonical.service';
import { PrivateSpatialGuard } from '../spatial/private-spatial.guard';

const REVISION_PATTERN = '^(current|[a-f0-9]{64})$';
const ETAG_HEADERS = {
  ETag: { schema: { type: 'string' }, description: 'Quoted complete projection revisionId' },
};

const schema = (value: z.ZodType) => {
  const { $schema: _dialect, ...result } = z.toJSONSchema(value, { target: 'openapi-3.0' });
  return result as never;
};

@ApiTags('canonical projections')
@UseGuards(PrivateSpatialGuard)
@Controller('api/v1')
export class CanonicalController {
  constructor(@Inject(CanonicalProjectionService) private readonly projections: CanonicalProjectionService) {}

  @Get('areas/:areaId/canonical')
  @ApiOperation({
    operationId: 'GET_api_v1_areas_areaId_canonical',
    summary: 'Read the private canonical ENU area projection without capture writes',
  })
  @ApiParam({ name: 'areaId', schema: { type: 'string', format: 'uuid' } })
  @ApiResponse({ status: 200, schema: schema(NormalizedAreaSchema), headers: ETAG_HEADERS })
  @ApiResponse({ status: 403, description: 'Private local operator/source access denied' })
  @ApiResponse({ status: 404, description: 'Area not found' })
  async area(@Param('areaId') areaId: string, @Res({ passthrough: true }) response: Response) {
    response.setHeader('Cache-Control', 'private, no-store');
    const result = NormalizedAreaSchema.parse(await this.projections.area(z.uuid().parse(areaId)));
    response.setHeader('ETag', `"${result.revisionId}"`);
    return result;
  }

  @Get('buildings/:buildingId/canonical')
  @ApiOperation({
    operationId: 'GET_api_v1_buildings_buildingId_canonical',
    summary: 'Read the private canonical building projection with exact current dependency revision',
  })
  @ApiParam({ name: 'buildingId', schema: { type: 'string', format: 'uuid' } })
  @ApiQuery({
    name: 'revision',
    required: false,
    schema: { type: 'string', pattern: REVISION_PATTERN },
    description: 'Current (default) or the exact current projection revisionId. '
      + 'Unavailable complete historical projections return 404.',
  })
  @ApiResponse({ status: 200, schema: schema(NormalizedBuildingSchema), headers: ETAG_HEADERS })
  @ApiResponse({ status: 403, description: 'Private local operator/source access denied' })
  @ApiResponse({ status: 404, description: 'Building or complete projection revision not found' })
  async building(
    @Param('buildingId') buildingId: string,
    @Query('revision') revision: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'private, no-store');
    const id = z.uuid().parse(buildingId);
    const exactRevision = z.string().regex(new RegExp(REVISION_PATTERN)).default('current').parse(revision);
    const result = NormalizedBuildingSchema.parse(await this.projections.building(id, exactRevision));
    response.setHeader('ETag', `"${result.revisionId}"`);
    return result;
  }
}
