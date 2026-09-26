import { Controller, Get, Post, Req, Res, Param, HttpCode, UseGuards } from '@nestjs/common';
import { ApiBody, ApiConsumes, ApiHeader, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AppError } from '@ulpin/server/infrastructure/errors';
import { documentFormat, documentLimitMiB } from '@ulpin/server/shared/document-formats';
import { listSpatialDatasets, getSpatialDataset, readSpatialDatasetOriginal } from '@ulpin/server/modules/spatial/spatial-datasets';
import { ensureDatasetIdentifiers, searchDatasetIdentifiers } from '@ulpin/server/modules/spatial/spatial-identifiers';
import { datasetMlOverview, queueDatasetMl, reviewDatasetMl, datasetMlArtifact, attachDatasetMlSource,
  datasetMlBatchSchema, datasetMlReviewSchema } from '@ulpin/server/modules/datasets/dataset-ml';
import { readBoundedBytes } from '../../common/body';
import { readMlJson } from './ml-json';
import { PrivateSpatialGuard } from './private-spatial.guard';
import { sendWebResponse, jsonResponse } from '../../common/response';
import { ApiResult, binary, datasetMlOverview as datasetMlOverviewSchema, identifier, identifierMatch,
  retired, review, savedDataset, uuid, wire } from './spatial.openapi';

function url(request: Request): URL {
  return new URL(request.originalUrl, `http://${request.headers.host}`);
}
function nameHeader(request: Request): string {
  try { return decodeURIComponent(request.header('x-file-name') ?? ''); }
  catch { throw new AppError(422, 'SOURCE_NAME', 'The source filename header is not valid UTF-8 escaping.'); }
}

@ApiTags('spatial datasets')
@UseGuards(PrivateSpatialGuard)
@Controller('api/v1/spatial-datasets/search')
export class DatasetSearchController {
  @Get()
  @HttpCode(200)
  @ApiOperation({ operationId: 'GET_api_v1_spatial_datasets_search', summary: 'Search retained application identifiers' })
  @ApiQuery({ name: 'q', required: false, schema: { type: 'string', maxLength: 150 } })
  @ApiResult(200, { type: 'object', required: ['matches'], properties: { matches: { type: 'array', items: identifierMatch } } })
  async search(@Req() request: Request) {
    const q = url(request).searchParams.get('q') ?? '';
    return { matches: await searchDatasetIdentifiers(q) };
  }
}

@ApiTags('spatial datasets')
@UseGuards(PrivateSpatialGuard)
@Controller('api/v1/spatial-datasets')
export class DatasetsController {
  @Get()
  @HttpCode(200)
  @ApiOperation({ operationId: 'GET_api_v1_spatial_datasets', summary: 'List retained saved datasets with recorded classification' })
  @ApiResult(200, { type: 'array', items: savedDataset })
  async list() { return listSpatialDatasets(); }

  @Post()
  @HttpCode(410)
  @ApiOperation({ operationId: 'POST_api_v1_spatial_datasets', summary: 'Retired synthetic-only saved dataset intake' })
  @ApiResult(410, retired, [])
  retiredIntake() {
    return { error: { code: 'RETIRED_SYNTHETIC_INTAKE',
      message: 'Saved dataset creation used a synthetic-only profile and is retired. Historical datasets and originals remain readable.',
      replacement: '/api/v1/import-packages (official or provenance-backed source workflow)' } };
  }

  @Get(':id')
  @HttpCode(200)
  @ApiOperation({ operationId: 'GET_api_v1_spatial_datasets_id', summary: 'Read dataset, application identifiers, or verified original bytes' })
  @ApiParam({ name: 'id', schema: { type: 'string', format: 'uuid' } })
  @ApiQuery({ name: 'identifiers', required: false, schema: { type: 'string', enum: ['1'] } })
  @ApiQuery({ name: 'original', required: false, schema: { type: 'string', enum: ['1'] } })
  @ApiResult(200, { oneOf: [savedDataset, { type: 'array', items: identifier }, binary] },
    [400, 403, 404, 409, 422, 503], {
      'X-Source-SHA256': { description: 'Verified unchanged original hash when original=1', schema: { type:'string',pattern:'^[a-f0-9]{64}$' } },
      'Content-Disposition': { description: 'Original filename attachment when original=1', schema: { type:'string' } },
    })
  async get(@Param('id') rawId: string, @Req() request: Request, @Res() response: Response) {
    const id = rawId, params = url(request).searchParams;
    const identifiers = params.get('identifiers') === '1';
    const original = params.get('original') === '1';
    if (identifiers) {
      await getSpatialDataset(id);
      return sendWebResponse(response, jsonResponse(await ensureDatasetIdentifiers(id)));
    }
    if (original) {
      const { dataset, bytes } = await readSpatialDatasetOriginal(id);
      return sendWebResponse(response, new globalThis.Response(new Uint8Array(bytes), { headers: {
        'Content-Type': dataset.originalName.endsWith('.zip') ? 'application/zip' : 'application/json',
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(dataset.originalName)}`,
        'X-Source-SHA256': dataset.sha256,
      } }));
    }
    return sendWebResponse(response, jsonResponse(await getSpatialDataset(id)));
  }

  @Get(':id/ml')
  @HttpCode(200)
  @ApiOperation({ operationId: 'GET_api_v1_spatial_datasets_id_ml', summary: 'Read retained dataset inference runs or verified raster bytes' })
  @ApiParam({ name: 'id', schema: { type: 'string', format: 'uuid' } })
  @ApiQuery({ name: 'artifact', required: false, schema: { type: 'string', enum: ['raster', 'mask'] } })
  @ApiQuery({ name: 'run', required: false, schema: { type: 'string', format: 'uuid' } })
  @ApiResult(200, { oneOf: [datasetMlOverviewSchema, binary] }, [400, 403, 404, 409, 422, 503])
  async ml(@Param('id') rawId: string, @Req() request: Request, @Res() response: Response) {
    const id = rawId, params = url(request).searchParams;
    if (params.has('artifact')) {
      return sendWebResponse(response, await datasetMlArtifact(id, params.get('run') ?? '', params.get('artifact') ?? ''));
    }
    return sendWebResponse(response, jsonResponse(await datasetMlOverview(id)));
  }

  @Post(':id/ml')
  @HttpCode(200)
  @ApiOperation({ operationId: 'POST_api_v1_spatial_datasets_id_ml', summary: 'Queue inference or review an exact retained dataset result' })
  @ApiParam({ name: 'id', schema: { type: 'string', format: 'uuid' } })
  @ApiQuery({ name: 'action', required: false, schema: { type: 'string', enum: ['review'] } })
  @ApiBody({ schema: { oneOf: [wire(datasetMlBatchSchema), wire(datasetMlReviewSchema)] } as never })
  @ApiResult(200, { oneOf: [datasetMlOverviewSchema, review] }, [400, 403, 404, 409, 413, 422, 503])
  async updateMl(@Param('id') rawId: string, @Req() request: Request) {
    const id = rawId, input = await readMlJson(request, 100_000);
    const action = url(request).searchParams.get('action');
    return action === 'review' ? reviewDatasetMl(id, datasetMlReviewSchema.parse(input)) : queueDatasetMl(id, datasetMlBatchSchema.parse(input));
  }

  @Post(':id/ml/source')
  @HttpCode(201)
  @ApiOperation({ operationId: 'POST_api_v1_spatial_datasets_id_ml_source', summary: 'Retain an exact PDF or image original for dataset inference' })
  @ApiParam({ name: 'id', schema: { type: 'string', format: 'uuid' } })
  @ApiHeader({ name: 'X-File-Name', required: true, description: 'UTF-8 percent-encoded plain filename' })
  @ApiHeader({ name: 'X-Request-Key', required: true, schema: { type: 'string', format: 'uuid' } })
  @ApiConsumes('application/octet-stream')
  @ApiBody({ required: true, schema: binary as never })
  @ApiResult(201, { type: 'object', required: ['caseId', 'sourceId'], properties: {
    caseId: { type: 'string', format: 'uuid' }, sourceId: { type: 'string', format: 'uuid' },
  } }, [400, 403, 404, 409, 413, 415, 422, 503])
  async addMlSource(@Param('id') rawId: string, @Req() request: Request) {
    const id = rawId, name = nameHeader(request);
    const key = uuid.parse(request.header('x-request-key'));
    const format = documentFormat(name);
    const limit = format === 'pdf' ? documentLimitMiB('pdf') * 1024 * 1024 : 16 * 1024 * 1024;
    const bytes = await readBoundedBytes(request, limit);
    return attachDatasetMlSource(id, name, bytes, key);
  }
}
