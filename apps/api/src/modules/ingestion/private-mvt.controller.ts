import {Controller,Get,HttpCode,Inject,Param,Post,Req,Res,UseGuards} from '@nestjs/common';
import {ApiOperation,ApiParam,ApiTags} from '@nestjs/swagger';
import type {Request,Response} from 'express';
import {z} from 'zod';
import {PrivateMvtRequestSchema,PrivateMvtStatusSchema,PrivateMvtManifestResponseSchema,PrivateMvtLookupSchema} from '@ulpin/contracts/usp';
import {PrivateMvtService} from '@ulpin/server/modules/usp/tiles/service';
import {AppError} from '@ulpin/server/infrastructure/errors';
import {JSON_BODY_LIMIT,readJsonBody} from '../../common/body';
import {jsonBody,wireResponse,binary} from '../intake/wire-schemas';
import {PrivateSpatialGuard} from '../spatial/private-spatial.guard';

const uuid=(name:string)=>ApiParam({name,schema:{type:'string',format:'uuid'}});
const number=(name:string)=>ApiParam({name,schema:{type:'integer',minimum:0}});
const decimal=z.string().regex(/^(0|[1-9]\d*)$/).transform(Number).pipe(z.number().int().safe());
function noQuery(request:Request){if(new URL(request.originalUrl,'http://localhost').search)throw new AppError(422,'MVT_QUERY','This pinned operation accepts no query fields.');}
const coordinate=(zValue:string,x:string,y:string)=>({z:decimal.parse(zValue),x:decimal.parse(x),y:decimal.parse(y)});

@ApiTags('private administrative display tiles')
@UseGuards(PrivateSpatialGuard)
@Controller('api/v1/ingestion/cases/:caseId/sources/:sourceId/private-mvt')
export class PrivateMvtController{
  constructor(@Inject(PrivateMvtService)private readonly tiles:PrivateMvtService){}
  @Post() @HttpCode(202) @uuid('caseId') @uuid('sourceId')
  @ApiOperation({operationId:'POST_api_v1_ingestion_cases_caseId_sources_sourceId_private_mvt',summary:'Queue a bounded private PostGIS MVT generation over exact admitted administrative observations'})
  @jsonBody(PrivateMvtRequestSchema) @wireResponse(202,PrivateMvtStatusSchema,[429])
  enqueue(@Param('caseId')caseId:string,@Param('sourceId')sourceId:string,@Req()request:Request){noQuery(request);return readJsonBody(request,JSON_BODY_LIMIT).then(value=>this.tiles.enqueue(caseId,sourceId,value));}
  @Get() @uuid('caseId') @uuid('sourceId')
  @ApiOperation({operationId:'GET_api_v1_ingestion_cases_caseId_sources_sourceId_private_mvt',summary:'Read private tile job status and the latest coherent generation pin'})
  @wireResponse(200,PrivateMvtStatusSchema)
  status(@Param('caseId')caseId:string,@Param('sourceId')sourceId:string,@Req()request:Request){noQuery(request);return this.tiles.status(caseId,sourceId);}
  @Get('generations/:jobId/:version') @uuid('caseId') @uuid('sourceId') @uuid('jobId') @number('version')
  @ApiOperation({operationId:'GET_api_v1_ingestion_cases_caseId_sources_sourceId_private_mvt_generations_jobId_version',summary:'Read one immutable coherent manifest with explicit ready and pending cells'})
  @wireResponse(200,PrivateMvtManifestResponseSchema)
  manifest(@Param('caseId')caseId:string,@Param('sourceId')sourceId:string,@Param('jobId')jobId:string,@Param('version')version:string,@Req()request:Request){noQuery(request);return this.tiles.manifest(caseId,sourceId,jobId,decimal.parse(version));}
  @Get('generations/:jobId/:version/tiles/:z/:x/:y.mvt') @uuid('caseId') @uuid('sourceId') @uuid('jobId') @number('version') @number('z') @number('x') @number('y')
  @ApiOperation({operationId:'GET_api_v1_ingestion_cases_caseId_sources_sourceId_private_mvt_generations_jobId_version_tiles_z_x_y',summary:'Read one hash-verified standard MVT cell after current private source authority checks'})
  @wireResponse(200,binary)
  async tile(@Param('caseId')caseId:string,@Param('sourceId')sourceId:string,@Param('jobId')jobId:string,@Param('version')version:string,
    @Param('z')zValue:string,@Param('x')x:string,@Param('y')y:string,@Req()request:Request,@Res()response:Response){
    noQuery(request);const result=await this.tiles.tile(caseId,sourceId,jobId,decimal.parse(version),coordinate(zValue,x,y));
    response.set({'Content-Type':'application/vnd.mapbox-vector-tile','Cache-Control':'private, no-store','Content-Length':String(result.bytes.length),
      'X-Content-SHA256':result.sha256,'X-MVT-Generation':`${result.pin.jobId}/${result.pin.version}`,'X-MVT-Manifest-SHA256':result.pin.sha256});
    response.send(result.bytes);
  }
  @Get('generations/:jobId/:version/tiles/:z/:x/:y/units/:unitId') @uuid('caseId') @uuid('sourceId') @uuid('jobId') @number('version') @number('z') @number('x') @number('y') @uuid('unitId')
  @ApiOperation({operationId:'GET_api_v1_ingestion_cases_caseId_sources_sourceId_private_mvt_generations_jobId_version_tiles_z_x_y_units_unitId',summary:'Resolve a tile pick through the exact source-observation identity map to its canonical administrative unit'})
  @wireResponse(200,PrivateMvtLookupSchema)
  lookup(@Param('caseId')caseId:string,@Param('sourceId')sourceId:string,@Param('jobId')jobId:string,@Param('version')version:string,
    @Param('z')zValue:string,@Param('x')x:string,@Param('y')y:string,@Param('unitId')unitId:string,@Req()request:Request){
    noQuery(request);return this.tiles.lookup(caseId,sourceId,jobId,decimal.parse(version),coordinate(zValue,x,y),unitId);
  }
}
