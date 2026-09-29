import {Controller,Get,HttpCode,Inject,Param,Post,Req,Res,UseGuards} from '@nestjs/common';
import {ApiOperation,ApiParam,ApiTags} from '@nestjs/swagger';
import type {Request,Response} from 'express';
import {PointRetainSchema,PointRetainReceiptSchema,PointBatchRequestSchema,PointBatchQueueReceiptSchema,
  PointBatchStatusSchema} from '@ulpin/contracts/usp';
import {PointBatchService} from '@ulpin/server/modules/usp/ingestion/point-batch';
import {AppError} from '@ulpin/server/infrastructure/errors';
import {JSON_BODY_LIMIT,MULTIPART_BODY_LIMIT,readJsonBody,readMultipartBody} from '../../common/body';
import {jsonBody,multipartBody,wireResponse,binary} from '../intake/wire-schemas';
import {PrivateSpatialGuard} from '../spatial/private-spatial.guard';

const param=(name:string)=>ApiParam({name,schema:{type:'string',format:'uuid'}});
function noQuery(request:Request){if(new URL(request.originalUrl,'http://localhost').searchParams.size)
  throw new AppError(422,'POINT_QUERY','This private point operation has no query fields.');}

@ApiTags('private point batches')
@UseGuards(PrivateSpatialGuard)
@Controller('api/v1/ingestion/cases/:caseId')
export class PointBatchController{
  constructor(@Inject(PointBatchService)private readonly points:PointBatchService){}
  @Post('points') @HttpCode(201) @param('caseId')
  @ApiOperation({operationId:'POST_api_v1_ingestion_cases_caseId_points',summary:'Retain unchanged bounded LAZ/COPC bytes and queue the first native point batch'})
  @multipartBody(['file','requestKey','expectedCaseRevision','lineage'],{requestKey:{type:'string',format:'uuid'},
    expectedCaseRevision:{type:'integer',minimum:0},lineage:{type:'string',description:'JSON lineage, including original versus native-point derivative'}})
  @wireResponse(201,PointRetainReceiptSchema)
  async retain(@Param('caseId')caseId:string,@Req()request:Request){
    noQuery(request);const form=await readMultipartBody(request,MULTIPART_BODY_LIMIT),file=form.get('file');
    if(!(file instanceof File))throw new AppError(400,'POINT_FILE_REQUIRED','Choose a LAZ/COPC original.');
    const allowed=new Set(['file','requestKey','expectedCaseRevision','lineage']);
    for(const key of form.keys())if(!allowed.has(key)||form.getAll(key).length!==1)
      throw new AppError(422,'POINT_FIELDS','Use one value for each declared point field.');
    if(!form.has('expectedCaseRevision'))throw new AppError(422,'POINT_CASE_PIN','Pin the current source-case revision.');
    let lineage:unknown;try{lineage=JSON.parse(String(form.get('lineage')));}catch{
      throw new AppError(422,'POINT_LINEAGE','Lineage must be a JSON object.');}
    const input=PointRetainSchema.parse({requestKey:form.get('requestKey'),expectedCaseRevision:Number(form.get('expectedCaseRevision')),lineage});
    return this.points.retain(caseId,input,{name:file.name,bytes:new Uint8Array(await file.arrayBuffer())});
  }
  @Post('sources/:sourceId/point-batches') @HttpCode(202) @param('caseId') @param('sourceId')
  @ApiOperation({operationId:'POST_api_v1_ingestion_cases_caseId_sources_sourceId_point_batches',summary:'Queue one exact bounded native point batch from a current retained LAZ/COPC'})
  @jsonBody(PointBatchRequestSchema) @wireResponse(202,PointBatchQueueReceiptSchema,[429])
  enqueue(@Param('caseId')caseId:string,@Param('sourceId')sourceId:string,@Req()request:Request){
    noQuery(request);return readJsonBody(request,JSON_BODY_LIMIT).then(value=>this.points.enqueue(caseId,sourceId,value));
  }
  @Get('sources/:sourceId/point-batches/jobs/:jobId') @param('caseId') @param('sourceId') @param('jobId')
  @ApiOperation({operationId:'GET_api_v1_ingestion_cases_caseId_sources_sourceId_point_batches_jobs_jobId',summary:'Read source-linked native batch metadata and recoverable job status'})
  @wireResponse(200,PointBatchStatusSchema)
  status(@Param('caseId')caseId:string,@Param('sourceId')sourceId:string,@Param('jobId')jobId:string,@Req()request:Request){
    noQuery(request);return this.points.status(caseId,sourceId,jobId);
  }
  @Get('sources/:sourceId/point-batches/jobs/:jobId/artifact') @param('caseId') @param('sourceId') @param('jobId')
  @ApiOperation({operationId:'GET_api_v1_ingestion_cases_caseId_sources_sourceId_point_batches_jobs_jobId_artifact',summary:'Fetch exact accepted private LAS point records'})
  @wireResponse(200,binary)
  async artifact(@Param('caseId')caseId:string,@Param('sourceId')sourceId:string,@Param('jobId')jobId:string,
    @Req()request:Request,@Res()response:Response){
    noQuery(request);const result=await this.points.artifact(caseId,sourceId,jobId);
    response.set({'Content-Type':'application/vnd.las.point-records','Cache-Control':'private, no-store','Content-Length':String(result.bytes.length),
      'X-Content-SHA256':result.sha256});response.send(result.bytes);
  }
}
