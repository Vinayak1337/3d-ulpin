import {Controller,Get,HttpCode,Inject,Param,Post,Req,Res,UseGuards} from '@nestjs/common';
import {ApiOperation,ApiParam,ApiTags} from '@nestjs/swagger';
import type {Request,Response} from 'express';
import {RasterRetainSchema,RasterRetainReceiptSchema,RasterWindowRequestSchema,RasterWindowQueueReceiptSchema,
  RasterWindowStatusSchema} from '@ulpin/contracts/usp';
import {RasterWindowService} from '@ulpin/server/modules/usp/ingestion/raster-window';
import {AppError} from '@ulpin/server/infrastructure/errors';
import {JSON_BODY_LIMIT,MULTIPART_BODY_LIMIT,readJsonBody,readMultipartBody} from '../../common/body';
import {jsonBody,multipartBody,wireResponse,binary} from '../intake/wire-schemas';
import {PrivateSpatialGuard} from '../spatial/private-spatial.guard';

const param=(name:string)=>ApiParam({name,schema:{type:'string',format:'uuid'}});
function noQuery(request:Request){if(new URL(request.originalUrl,'http://localhost').searchParams.size)
  throw new AppError(422,'RASTER_QUERY','This private raster operation has no query fields.');}

@ApiTags('private raster windows')
@UseGuards(PrivateSpatialGuard)
@Controller('api/v1/ingestion/cases/:caseId')
export class RasterWindowController{
  constructor(@Inject(RasterWindowService)private readonly rasters:RasterWindowService){}
  @Post('rasters') @HttpCode(201) @param('caseId')
  @ApiOperation({operationId:'POST_api_v1_ingestion_cases_caseId_rasters',summary:'Retain unchanged bounded GeoTIFF bytes and queue the first native pixel window'})
  @multipartBody(['file','requestKey','expectedCaseRevision','lineage'],{requestKey:{type:'string',format:'uuid'},
    expectedCaseRevision:{type:'integer',minimum:0},lineage:{type:'string',description:'JSON lineage, including original versus native-grid derivative'}})
  @wireResponse(201,RasterRetainReceiptSchema)
  async retain(@Param('caseId')caseId:string,@Req()request:Request){
    noQuery(request);const form=await readMultipartBody(request,MULTIPART_BODY_LIMIT),file=form.get('file');
    if(!(file instanceof File))throw new AppError(400,'RASTER_FILE_REQUIRED','Choose a GeoTIFF original.');
    const allowed=new Set(['file','requestKey','expectedCaseRevision','lineage']);
    for(const key of form.keys())if(!allowed.has(key)||form.getAll(key).length!==1)
      throw new AppError(422,'RASTER_FIELDS','Use one value for each declared raster field.');
    if(!form.has('expectedCaseRevision'))throw new AppError(422,'RASTER_CASE_PIN','Pin the current source-case revision.');
    let lineage:unknown;try{lineage=JSON.parse(String(form.get('lineage')));}catch{
      throw new AppError(422,'RASTER_LINEAGE','Lineage must be a JSON object.');}
    const input=RasterRetainSchema.parse({requestKey:form.get('requestKey'),expectedCaseRevision:Number(form.get('expectedCaseRevision')),lineage});
    return this.rasters.retain(caseId,input,{name:file.name,bytes:new Uint8Array(await file.arrayBuffer())});
  }
  @Post('sources/:sourceId/raster-windows') @HttpCode(202) @param('caseId') @param('sourceId')
  @ApiOperation({operationId:'POST_api_v1_ingestion_cases_caseId_sources_sourceId_raster_windows',summary:'Queue one exact bounded native raster window from a current retained GeoTIFF'})
  @jsonBody(RasterWindowRequestSchema) @wireResponse(202,RasterWindowQueueReceiptSchema,[429])
  enqueue(@Param('caseId')caseId:string,@Param('sourceId')sourceId:string,@Req()request:Request){
    noQuery(request);return readJsonBody(request,JSON_BODY_LIMIT).then(value=>this.rasters.enqueue(caseId,sourceId,value));
  }
  @Get('sources/:sourceId/raster-windows/jobs/:jobId') @param('caseId') @param('sourceId') @param('jobId')
  @ApiOperation({operationId:'GET_api_v1_ingestion_cases_caseId_sources_sourceId_raster_windows_jobs_jobId',summary:'Read source-linked native window metadata and recoverable job status'})
  @wireResponse(200,RasterWindowStatusSchema)
  status(@Param('caseId')caseId:string,@Param('sourceId')sourceId:string,@Param('jobId')jobId:string,@Req()request:Request){
    noQuery(request);return this.rasters.status(caseId,sourceId,jobId);
  }
  @Get('sources/:sourceId/raster-windows/jobs/:jobId/artifact') @param('caseId') @param('sourceId') @param('jobId')
  @ApiOperation({operationId:'GET_api_v1_ingestion_cases_caseId_sources_sourceId_raster_windows_jobs_jobId_artifact',summary:'Fetch the exact accepted private native GeoTIFF window'})
  @wireResponse(200,binary)
  async artifact(@Param('caseId')caseId:string,@Param('sourceId')sourceId:string,@Param('jobId')jobId:string,
    @Req()request:Request,@Res()response:Response){
    noQuery(request);const result=await this.rasters.artifact(caseId,sourceId,jobId);
    response.set({'Content-Type':'image/tiff','Cache-Control':'private, no-store','Content-Length':String(result.bytes.length),
      'X-Content-SHA256':result.sha256});response.send(result.bytes);
  }
}
