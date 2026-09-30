import {Controller,Get,Header,HttpCode,Inject,Param,Post,Req,Res,UseGuards} from '@nestjs/common';
import {ApiOperation,ApiParam,ApiTags} from '@nestjs/swagger';
import type {Request,Response} from 'express';
import {CityJSONRetainSchema,CityJSONRetainReceiptSchema,CityJSONRequestSchema,CityJSONQueueReceiptSchema,
  CityJSONStatusSchema} from '@ulpin/contracts/usp';
import {CityJSONIngestionService} from '@ulpin/server/modules/usp/ingestion/cityjson';
import {AppError} from '@ulpin/server/infrastructure/errors';
import {readJsonBody,readMultipartBody} from '../../common/body';
import {jsonBody,multipartBody,wireResponse,binary} from '../intake/wire-schemas';
import {PrivateSpatialGuard} from '../spatial/private-spatial.guard';

const param=(name:string)=>ApiParam({name,schema:{type:'string',format:'uuid'}});
function noQuery(request:Request){if(new URL(request.originalUrl,'http://localhost').searchParams.size)
  throw new AppError(422,'CITYJSON_QUERY','This private CityJSON operation has no query fields.');}

@ApiTags('private CityJSON native reading')
@UseGuards(PrivateSpatialGuard)
@Controller('api/v1/ingestion/cases/:caseId')
export class CityJSONController{
  constructor(@Inject(CityJSONIngestionService)private readonly cityjson:CityJSONIngestionService){}
  @Post('cityjson') @HttpCode(201) @param('caseId')
  @ApiOperation({operationId:'POST_api_v1_ingestion_cases_caseId_cityjson',summary:'Retain unchanged bounded source bytes and queue native CityJSON reading'})
  @multipartBody(['file','requestKey','expectedCaseRevision','lineage'],{requestKey:{type:'string',format:'uuid'},
    expectedCaseRevision:{type:'integer',minimum:0},lineage:{type:'string',description:'JSON lineage, including issuer/source URL/geography and permission limitations'}})
  @wireResponse(201,CityJSONRetainReceiptSchema)
  async retain(@Param('caseId')caseId:string,@Req()request:Request){
    noQuery(request);const form=await readMultipartBody(request,9*1024*1024),file=form.get('file');
    if(!(file instanceof File))throw new AppError(400,'CITYJSON_FILE_REQUIRED','Choose an unchanged source to retain for native CityJSON reading.');
    const allowed=new Set(['file','requestKey','expectedCaseRevision','lineage']);
    for(const key of form.keys())if(!allowed.has(key)||form.getAll(key).length!==1)
      throw new AppError(422,'CITYJSON_FIELDS','Use one value for each declared CityJSON field.');
    if(!form.has('expectedCaseRevision'))throw new AppError(422,'CITYJSON_CASE_PIN','Pin the current source-case revision.');
    let lineage:unknown;try{lineage=JSON.parse(String(form.get('lineage')));}catch{
      throw new AppError(422,'CITYJSON_LINEAGE','Lineage must be a JSON object.');}
    const input=CityJSONRetainSchema.parse({requestKey:form.get('requestKey'),expectedCaseRevision:Number(form.get('expectedCaseRevision')),lineage});
    return this.cityjson.retain(caseId,input,{name:file.name,bytes:new Uint8Array(await file.arrayBuffer())});
  }
  @Post('sources/:sourceId/cityjson/retries') @HttpCode(202) @param('caseId') @param('sourceId')
  @ApiOperation({operationId:'POST_api_v1_ingestion_cases_caseId_sources_sourceId_cityjson_retries',summary:'Retry native CityJSON reading with current source and context pins'})
  @jsonBody(CityJSONRequestSchema) @wireResponse(202,CityJSONQueueReceiptSchema,[429])
  enqueue(@Param('caseId')caseId:string,@Param('sourceId')sourceId:string,@Req()request:Request){
    noQuery(request);return readJsonBody(request,16*1024).then(value=>this.cityjson.enqueue(caseId,sourceId,value));
  }
  @Get('sources/:sourceId/cityjson/jobs/:jobId') @param('caseId') @param('sourceId') @param('jobId')
  @Header('Cache-Control','private, no-store')
  @ApiOperation({operationId:'GET_api_v1_ingestion_cases_caseId_sources_sourceId_cityjson_jobs_jobId',summary:'Read bounded private native summary and recoverable status'})
  @wireResponse(200,CityJSONStatusSchema)
  status(@Param('caseId')caseId:string,@Param('sourceId')sourceId:string,@Param('jobId')jobId:string,@Req()request:Request){
    noQuery(request);return this.cityjson.status(caseId,sourceId,jobId);
  }
  @Get('sources/:sourceId/cityjson/jobs/:jobId/native') @param('caseId') @param('sourceId') @param('jobId')
  @ApiOperation({operationId:'GET_api_v1_ingestion_cases_caseId_sources_sourceId_cityjson_jobs_jobId_native',summary:'Download bounded exact accepted native CityJSON result'})
  @wireResponse(200,binary)
  async artifact(@Param('caseId')caseId:string,@Param('sourceId')sourceId:string,@Param('jobId')jobId:string,
    @Req()request:Request,@Res()response:Response){
    noQuery(request);const result=await this.cityjson.artifact(caseId,sourceId,jobId);
    response.set({'Content-Type':'application/json','Cache-Control':'private, no-store','Content-Length':String(result.bytes.length),'X-CityJSON-Native-Profile':'source-native-cityjson/1',
      'X-Content-SHA256':result.sha256});response.send(result.bytes);
  }
  @Get('sources/:sourceId/cityjson/original') @param('caseId') @param('sourceId')
  @ApiOperation({operationId:'GET_api_v1_ingestion_cases_caseId_sources_sourceId_cityjson_original',summary:'Download unchanged retained original through current CityJSON access authority'})
  @wireResponse(200,binary)
  async original(@Param('caseId')caseId:string,@Param('sourceId')sourceId:string,@Req()request:Request,@Res()response:Response){
    noQuery(request);const result=await this.cityjson.original(caseId,sourceId);
    response.set({'Content-Type':result.mimeType,'Cache-Control':'private, no-store','Content-Length':String(result.bytes.length),
      'Content-Disposition':'attachment; filename="cityjson-original.json"','X-Content-SHA256':result.sha256});response.send(result.bytes);
  }
}
