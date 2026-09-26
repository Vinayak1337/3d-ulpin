import { Controller, Get, Param, Req, Res, HttpCode, UseGuards, Header } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { CoreContractError, CoreSnapshotInputSchema, CoreSnapshotManifestSchema, CoreGeometryCatalogSchema,
  CoreRefSchema, CoreRevisionRefSchema } from '@ulpin/contracts';
import { AppError } from '@ulpin/server/infrastructure/errors';
import { readSpatialAreaCompatibility } from '@ulpin/server/modules/spatial/spatial-area-compat';
import { readNormalizedLegacyCore } from '@ulpin/server/modules/spatial/spatial-core-http';
import { LegacySpatialReadError } from '@ulpin/server/modules/spatial/spatial-core-read';
import { readNeighbourhoodSceneAsset } from '@ulpin/server/modules/spatial/spatial-core-scene';
import { readExternalScene } from '@ulpin/server/modules/usp/external-scene';
import { sendWebResponse } from '../../common/response';
import { PrivateSpatialGuard } from './private-spatial.guard';
import { ApiResult, areaReference, binary, coordinateFrame, digest, externalScene, height, legacyAreaProjection, neighbourhoodView,
  retired, revision, uuid, wire, world } from './spatial.openapi';

function url(request: Request): URL { return new URL(request.originalUrl, `http://${request.headers.host}`); }
function oneQuery(params: URLSearchParams, allowed: readonly string[]): void {
  for (const key of params.keys())
    if (!allowed.includes(key) || params.getAll(key).length !== 1)
      throw new AppError(400, 'READ_PARAMETER', 'Unsupported or repeated spatial read parameter.');
}
function pathFrom(request: Request, anchor: string): string[] {
  const path = url(request).pathname;
  const index = path.indexOf(anchor);
  if (index < 0) throw new AppError(404, 'SCENE_ASSET', 'Unknown scene asset.');
  return path.slice(index + anchor.length).split('/').map(segment => {
    try {
      const value = decodeURIComponent(segment);
      if (!value || value.includes('/') || value.includes('\\')) throw new Error('Invalid asset segment.');
      return value;
    } catch { throw new AppError(404, 'SCENE_ASSET', 'Unknown scene asset.'); }
  });
}
function translate(error: unknown): never {
  if (error instanceof LegacySpatialReadError) throw new AppError(error.status, error.code, error.message);
  if (error instanceof CoreContractError) throw new AppError(422, error.code, 'The legacy slice could not be normalized without changing its meaning.');
  throw new AppError(503, 'LEGACY_READ_FAILED', 'The consistent spatial read is unavailable.');
}
async function sendScene(response: Response, asset: globalThis.Response) {
  if (!asset.ok) {
    const body = await asset.json() as {error?:{code?:string;message?:string}};
    throw new AppError(asset.status, body.error?.code ?? 'SCENE_UNAVAILABLE',
      body.error?.message ?? 'The scene asset is unavailable.');
  }
  return sendWebResponse(response, asset);
}

@ApiTags('spatial reads')
@UseGuards(PrivateSpatialGuard)
@Controller('api/v1/spatial/areas')
export class SpatialAreaController {
  @Get(':areaId')
  @HttpCode(200)
  @ApiOperation({ operationId: 'GET_api_v1_spatial_areas_areaId', summary: 'Read the legacy area projection in an explicit world' })
  @ApiParam({ name: 'areaId', schema: { type: 'string', format: 'uuid' } })
  @ApiQuery({ name: 'world', required: true, schema: { type: 'string', enum: world.options } })
  @ApiResult(200, legacyAreaProjection, [400, 403, 404, 422, 503])
  async area(@Param('areaId') rawId: string, @Req() request: Request) {
    const params = url(request).searchParams;
    oneQuery(params, ['world']);
    const parsedId = uuid.safeParse(rawId), selected = world.safeParse(params.get('world'));
    if (!parsedId.success) throw new AppError(400, 'AREA_ID', 'Invalid area ID.');
    if (!selected.success) throw new AppError(400, 'WORLD_REQUIRED', 'Choose an explicit world: observed, planned, hypothetical or synthetic.');
    try { return await readSpatialAreaCompatibility(parsedId.data, selected.data); }
    catch { throw new AppError(422, 'SPATIAL_COMPAT_UNAVAILABLE',
      'Area data is unavailable or outside the supported compatibility profile. Existing records were not changed.'); }
  }
}

@ApiTags('spatial reads')
@UseGuards(PrivateSpatialGuard)
@Controller('api/v1/spatial/core/areas')
export class SpatialCoreController {
  @Get(':areaId')
  @HttpCode(200)
  @ApiOperation({ operationId: 'GET_api_v1_spatial_core_areas_areaId', summary: 'Bounded repeatable-read normalized spatial slice' })
  @ApiParam({ name: 'areaId', schema: { type: 'string', format: 'uuid' } })
  @ApiQuery({ name: 'world', required: true, schema: { type: 'string', enum: world.options } })
  @ApiQuery({ name: 'expectedDigest', required: false, schema: { type: 'string', pattern: '^[a-f0-9]{64}$' } })
  @ApiResult(200, { type: 'object', required: ['schemaVersion','readDigest','input','snapshot','legacy','diagnostics','consistency','selection'], properties: {
    schemaVersion: { type: 'string', enum: ['ulpin-legacy-normalization/1'] },
    readDigest: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    input: wire(CoreSnapshotInputSchema),
    snapshot: { type: 'object', required: ['manifest','geometry','results'], properties: {
      manifest: wire(CoreSnapshotManifestSchema),
      geometry: wire(CoreGeometryCatalogSchema),
      results: { type: 'array', items: { type: 'object', required: ['composition','entity','status','representation','reasonCode','temporalCoverage'],
        properties: { composition:wire(CoreRevisionRefSchema),entity:wire(CoreRefSchema),status:{type:'string',enum:['available','unavailable']},
          representation:{...wire(CoreRevisionRefSchema),nullable:true},reasonCode:{type:'string',nullable:true},
          temporalCoverage:{type:'string',enum:['bounded','unknown']} } } },
    } },
    legacy: { type: 'object', required: ['area','sites','features','records','sources','locators'], properties: {
      area: {type:'object',required:['id','siteId','revision','name','reference'],properties:{
        id:{type:'string',format:'uuid'},siteId:{type:'string',format:'uuid'},revision:{type:'integer'},name:{type:'string'},reference:{...areaReference,nullable:true}}},
      sites:{type:'array',items:{type:'object',required:['id','revision','frame'],properties:{
        id:{type:'string',format:'uuid'},revision:{type:'integer'},frame:coordinateFrame}}},
      features:{type:'array',items:{type:'object',required:['ref','revision','ownerAreaId','recordId','sourceRevisionId','sourceKey','datasetNamespace','floorCount','attribution','license','ownerReference','sourceReference','height','storedAreaM2'],properties:{
        ref:wire(CoreRefSchema),revision:{type:'integer'},ownerAreaId:{type:'string',format:'uuid'},recordId:{type:'string',format:'uuid',nullable:true},
        sourceRevisionId:{type:'string',format:'uuid'},sourceKey:{type:'string'},datasetNamespace:{type:'string'},
        floorCount:{type:'integer',nullable:true},attribution:{type:'string',nullable:true},license:{type:'string',nullable:true},
        ownerReference:{...areaReference,nullable:true},sourceReference:{...areaReference,nullable:true},height:{...height,nullable:true},storedAreaM2:{type:'number',nullable:true},
      }}},
      records:{type:'array',items:{type:'object',required:['ref','revision','siteId','kind','synthetic','geometryQuality'],properties:{
        ref:wire(CoreRefSchema),revision:{type:'integer'},siteId:{type:'string',format:'uuid'},kind:{type:'string'},synthetic:{type:'boolean'},
        geometryQuality:{type:'object',nullable:true,required:['id','lowerVerified','upperVerified','storedArea','storedHeight','storedVolume'],properties:{
          id:{type:'string'},lowerVerified:{type:'boolean'},upperVerified:{type:'boolean'},
          storedArea:{type:'number',nullable:true},storedHeight:{type:'number',nullable:true},storedVolume:{type:'number',nullable:true}}}}}},
      sources:{type:'array',items:{type:'object',required:['id','revision','familyId','sha256','bytes'],properties:{
        id:{type:'string',format:'uuid'},revision:{type:'integer'},familyId:{type:'string',format:'uuid'},sha256:{type:'string',pattern:'^[a-f0-9]{64}$'},bytes:{type:'integer'}}}},
      locators:{type:'array',items:{type:'object',required:['part','legacy'],properties:{
        part:wire(CoreRefSchema),legacy:{description:'Unchanged source-native locator value retained by the adapter'}}}},
    } },
    diagnostics: {type:'array',items:{type:'object',required:['code','target','message'],properties:{
      code:{type:'string'},target:{type:'object'},message:{type:'string'}}}},
    consistency:{type:'string',enum:['repeatable-read-read-only']},
    selection:{type:'string',enum:['published-current-only']},
  } }, [400, 403, 404, 409, 413, 422, 503], {
    ETag:{description:'Quoted coherent readDigest',schema:{type:'string'}},
  })
  async core(@Param('areaId') rawId: string, @Req() request: Request, @Res() response: Response) {
    const params = url(request).searchParams;
    oneQuery(params, ['world', 'expectedDigest']);
    const expected = params.get('expectedDigest');
    try {
      const result = await readNormalizedLegacyCore(rawId, params.get('world') ?? '', expected ?? undefined);
      return sendWebResponse(response, new globalThis.Response(result.body, { headers: {
        'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff', ETag: `"${result.readDigest}"`,
      } }));
    } catch (error) { translate(error); }
  }

  @Get(':areaId/scene/*assetPath')
  @HttpCode(200)
  @ApiOperation({ operationId: 'GET_api_v1_spatial_core_areas_areaId_scene_assetPath', summary: 'Read private scene descriptor, manifest or hash-pinned GLB' })
  @ApiParam({ name: 'areaId', schema: { type: 'string', format: 'uuid' } })
  @ApiParam({ name: 'assetPath', schema: { type: 'string', description: 'world/descriptor.json, world/digest/manifest.json, or world/digest/publicationId/tile.glb' } })
  @ApiResult(200, { oneOf: [neighbourhoodView,
    { type:'object',required:['asset','geometricError','root','extras'],properties:{
      asset:{type:'object',required:['version','tilesetVersion'],properties:{version:{type:'string'},tilesetVersion:{type:'string'}}},
      geometricError:{type:'number'},root:{type:'object'},extras:{type:'object',required:['worldId','worldState','snapshotId','snapshotRevision','style'],properties:{
        worldId:{type:'string'},worldState:{type:'string'},snapshotId:{type:'string'},snapshotRevision:{type:'integer'},style:{type:'string'}}}}},
    binary] }, [400, 403, 404, 409, 413, 422, 429, 503])
  async scene(@Param('areaId') rawId: string, @Req() request: Request, @Res() response: Response) {
    const path = pathFrom(request, `/api/v1/spatial/core/areas/${rawId}/scene/`);
    return sendScene(response, await readNeighbourhoodSceneAsset(rawId, path));
  }

  @Get(':areaId/external/:featureId')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ operationId: 'GET_api_v1_spatial_core_areas_areaId_external_featureId', summary: 'Read exact retained CityJSON exterior without asserting analytical volume' })
  @ApiParam({ name: 'areaId', schema: { type: 'string', format: 'uuid' } })
  @ApiParam({ name: 'featureId', schema: { type: 'string', format: 'uuid' } })
  @ApiQuery({ name: 'revision', required: true, schema: { type: 'integer', minimum: 1 } })
  @ApiQuery({ name: 'sha256', required: true, schema: { type: 'string', pattern: '^[a-f0-9]{64}$' } })
  @ApiResult(200, externalScene, [400, 403, 404, 409, 413, 422, 503])
  async external(@Param('areaId') rawAreaId: string, @Param('featureId') rawFeatureId: string, @Req() request: Request) {
    const params = url(request).searchParams;
    oneQuery(params, ['revision', 'sha256']);
    try { return await readExternalScene({
      areaId: uuid.parse(rawAreaId), featureId: uuid.parse(rawFeatureId),
      revision: revision.parse(params.get('revision')), sha256: digest.parse(params.get('sha256')),
    }); } catch (error) {
      if (error instanceof LegacySpatialReadError) throw new AppError(error.status, error.code, error.message);
      if (error instanceof z.ZodError) throw new AppError(400, 'EXTERNAL_UNAVAILABLE', 'The retained source exterior is unavailable.');
      throw error;
    }
  }
}

@ApiTags('spatial reads')
@UseGuards(PrivateSpatialGuard)
@Controller('api/v1/spatial/calibration')
export class SpatialCalibrationController {
  @Get(':kind/*assetPath')
  @HttpCode(410)
  @ApiOperation({ operationId: 'GET_api_v1_spatial_calibration_kind_assetPath', summary: 'Retired public synthetic calibration assets' })
  @ApiParam({ name: 'kind', schema: { type: 'string', enum: ['garden', 'dense'] } })
  @ApiParam({ name: 'assetPath', schema: { type: 'string' } })
  @ApiResult(410, retired, [403, 404])
  retiredAsset(@Param('kind') kind: string, @Req() request: Request) {
    const path = pathFrom(request, `/api/v1/spatial/calibration/${kind}/`);
    if (!['garden','dense'].includes(kind)) throw new AppError(404, 'CALIBRATION_UNKNOWN', 'Unknown calibration dataset.');
    const known = path.length === 1 && ['manifest.json','snapshot.json','summary.json'].includes(path[0])
      || path.length === 2 && /^[a-f0-9]{64}$/.test(path[0]) && /^(context|[-0-9]+_[-0-9]+-(coarse|detail))\.glb$/.test(path[1]);
    if (!known) throw new AppError(404, 'CALIBRATION_ASSET', 'Unknown calibration asset.');
    return { error: { code: 'RETIRED_SYNTHETIC_CALIBRATION',
      message: 'Public synthetic calibration asset generation is retired.',
      replacement: 'Use retained original source assets through the private import-package and spatial ML workflows.' } };
  }
}
