import { Controller, Get, Post, Req, Res, Param, HttpCode, UseGuards, Header } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  spatialMlStatus, listSpatialMlBatches, createSpatialMlBatch, getSpatialMlBatch,
  getSpatialMlItem, spatialMlArtifact, retrySpatialMlItem, cancelSpatialMlItem, applySpatialMlItem,
  spatialMlBatchSchema, spatialMlApplySchema,
  createSpatialMlSourceBatch, spatialMlSourceBatchSchema,
} from '@ulpin/server/modules/spatial/spatial-ml';
import { createSpatialMlFootprintDraft, spatialMlFootprintDraftSchema } from '@ulpin/server/modules/spatial/spatial-ml-footprints';
import { readBoundedBytes } from '../../common/body';
import { readMlJson } from './ml-json';
import { PrivateSpatialGuard } from './private-spatial.guard';
import { sendWebResponse } from '../../common/response';
import {
  ApiResult, binary, footprintDraftResult, mlBatch, mlItem, mlStatus, packageProjection,
  requestKey, uuid, requestWire as wire,
} from './spatial.openapi';

const JSON_LIMIT = 100_000;
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const artifactKind = z.enum(['raster', 'mask']);
function url(request: Request) { return new URL(request.originalUrl, `http://${request.headers.host}`); }
const itemParam = { name: 'itemId', schema: { type: 'string', format: 'uuid' } };

@ApiTags('spatial ML')
@UseGuards(PrivateSpatialGuard)
@Controller('api/v1/spatial-ml')
export class SpatialMlController {
  @Get('status')
  @HttpCode(200)
  @ApiOperation({ operationId: 'GET_api_v1_spatial_ml_status', summary: 'Read allowlisted private processor model status' })
  @ApiResult(200, mlStatus, [403, 503])
  status() { return spatialMlStatus(); }

  @Get('batches')
  @HttpCode(200)
  @ApiOperation({ operationId: 'GET_api_v1_spatial_ml_batches', summary: 'List retained batches for one preparation' })
  @ApiQuery({ name: 'packageId', required: true, schema: { type: 'string', format: 'uuid' } })
  @ApiResult(200, { type: 'array', items: mlBatch })
  batches(@Req() request: Request) {
    return listSpatialMlBatches(uuid.parse(url(request).searchParams.get('packageId')));
  }

  @Post('batches')
  @HttpCode(201)
  @ApiOperation({ operationId: 'POST_api_v1_spatial_ml_batches', summary: 'Queue an exact-revision, idempotent private inference batch' })
  @ApiBody({ schema: wire(spatialMlBatchSchema) as never })
  @ApiResult(201, mlBatch, [400, 403, 404, 409, 413, 422, 503])
  async createBatch(@Req() request: Request) {
    return createSpatialMlBatch(spatialMlBatchSchema.parse(await readMlJson(request, JSON_LIMIT)));
  }

  @Post('source-batches')
  @Header('Cache-Control', 'no-store')
  @HttpCode(201)
  @ApiOperation({ operationId: 'POST_api_v1_spatial_ml_source_batches', summary: 'Queue source-only PDF floor-plan pixel candidates',
    description: 'Pins the current private source/case, actual page/frame and explicit normalized region. No preparation, native part, metric placement or property target is implied.' })
  @ApiBody({ schema: wire(spatialMlSourceBatchSchema) as never })
  @ApiResult(201, mlBatch, [400, 403, 404, 409, 413, 422, 429, 503, 504])
  async createSourceBatch(@Req() request: Request) {
    return createSpatialMlSourceBatch(spatialMlSourceBatchSchema.parse(await readMlJson(request, JSON_LIMIT)));
  }

  @Get('batches/:batchId')
  @Header('Cache-Control', 'no-store')
  @HttpCode(200)
  @ApiOperation({ operationId: 'GET_api_v1_spatial_ml_batches_batchId', summary: 'Read one retained batch and its items' })
  @ApiParam({ name: 'batchId', schema: { type: 'string', format: 'uuid' } })
  @ApiResult(200, mlBatch)
  batch(@Param('batchId') id: string) { return getSpatialMlBatch(uuid.parse(id)); }

  @Get('items/:itemId')
  @Header('Cache-Control', 'no-store')
  @HttpCode(200)
  @ApiOperation({ operationId: 'GET_api_v1_spatial_ml_items_itemId', summary: 'Read one inference item without private worker input' })
  @ApiParam(itemParam)
  @ApiResult(200, mlItem)
  item(@Param('itemId') id: string) { return getSpatialMlItem(uuid.parse(id)); }

  @Get('items/:itemId/artifacts/:artifact')
  @HttpCode(200)
  @ApiOperation({ operationId: 'GET_api_v1_spatial_ml_items_itemId_artifacts_artifact', summary: 'Read hash-pinned retained raster or mask bytes' })
  @ApiParam(itemParam)
  @ApiParam({ name: 'artifact', schema: { type: 'string', enum: ['raster', 'mask'] } })
  @ApiQuery({ name: 'jobId', required: true, schema: { type: 'string', format: 'uuid' } })
  @ApiQuery({ name: 'sha256', required: true, schema: { type: 'string', pattern: '^[a-f0-9]{64}$' } })
  @ApiResult(200, binary, [400, 403, 404, 409, 422, 503], {
    'X-Content-SHA256': { description:'Verified retained artifact hash',schema:{type:'string',pattern:'^[a-f0-9]{64}$'} },
    'Cache-Control': { schema:{type:'string',enum:['private, max-age=31536000, immutable', 'no-store']} },
  })
  async artifact(@Param('itemId') rawId: string, @Param('artifact') rawKind: string,
    @Req() request: Request, @Res() response: Response) {
    const id = uuid.parse(rawId), kind = artifactKind.parse(rawKind), selected = url(request);
    uuid.parse(selected.searchParams.get('jobId'));
    sha.parse(selected.searchParams.get('sha256'));
    return sendWebResponse(response, await spatialMlArtifact(id, kind, selected));
  }

  @Post('items/:itemId/retry')
  @Header('Cache-Control', 'no-store')
  @HttpCode(200)
  @ApiOperation({ operationId: 'POST_api_v1_spatial_ml_items_itemId_retry', summary: 'Retry a failed item with the same source and pinned model' })
  @ApiParam(itemParam)
  @ApiBody({ schema: wire(requestKey) as never })
  @ApiResult(200, mlItem, [400, 403, 404, 409, 413, 422, 503])
  async retry(@Param('itemId') rawId: string, @Req() request: Request) {
    const id = uuid.parse(rawId), input = requestKey.parse(await readMlJson(request, JSON_LIMIT));
    return retrySpatialMlItem(id, input.requestKey);
  }

  @Post('items/:itemId/cancel')
  @Header('Cache-Control', 'no-store')
  @HttpCode(200)
  @ApiOperation({ operationId: 'POST_api_v1_spatial_ml_items_itemId_cancel', summary: 'Fence a queued or running item against late publication', description: 'No request body is accepted.' })
  @ApiParam(itemParam)
  @ApiResult(200, mlItem, [400, 403, 404, 409, 413, 422, 503])
  async cancel(@Param('itemId') rawId: string, @Req() request: Request) {
    await readBoundedBytes(request, 0);
    return cancelSpatialMlItem(uuid.parse(rawId));
  }

  @Post('items/:itemId/apply')
  @HttpCode(200)
  @ApiOperation({ operationId: 'POST_api_v1_spatial_ml_items_itemId_apply', summary: 'Add selected calibrated geometry as draft preparation facts' })
  @ApiParam(itemParam)
  @ApiBody({ schema: wire(spatialMlApplySchema) as never })
  @ApiResult(200, { type: 'object', required: ['package', 'item'], properties: {
    package: packageProjection, item: mlItem,
  } }, [400, 403, 404, 409, 413, 422, 503])
  async apply(@Param('itemId') rawId: string, @Req() request: Request) {
    return applySpatialMlItem(uuid.parse(rawId), spatialMlApplySchema.parse(await readMlJson(request, JSON_LIMIT)));
  }

  @Post('items/:itemId/footprint-drafts')
  @HttpCode(200)
  @ApiOperation({ operationId: 'POST_api_v1_spatial_ml_items_itemId_footprint_drafts',
    summary: 'Review source building pixels; reject-only decisions create no package' })
  @ApiParam(itemParam)
  @ApiBody({ schema: wire(spatialMlFootprintDraftSchema) as never })
  @ApiResult(200, footprintDraftResult, [400, 403, 404, 409, 413, 422, 503])
  async footprintDraft(@Param('itemId') rawId: string, @Req() request: Request) {
    return createSpatialMlFootprintDraft(uuid.parse(rawId),
      spatialMlFootprintDraftSchema.parse(await readMlJson(request, JSON_LIMIT)));
  }
}
