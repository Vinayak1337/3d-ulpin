import {Controller,Get,Header,HttpCode,Inject,Param,Post,Req,Res,UseGuards} from '@nestjs/common';
import {ApiOperation,ApiParam,ApiTags} from '@nestjs/swagger';
import type {Request,Response} from 'express';
import {CityGMLRetainSchema,CityGMLRetainReceiptSchema,CityGMLRequestSchema,CityGMLQueueReceiptSchema,
  CityGMLStatusSchema,CITYGML_LIMITS} from '../../../../../packages/contracts/src/usp/citygml-ingestion';
import {CityGMLIngestionService} from '@ulpin/server/modules/usp/ingestion/citygml';
import {AppError} from '@ulpin/server/infrastructure/errors';
import {readBoundedBytes} from '../../common/body';
import {jsonBody,multipartBody,wireResponse,binary} from '../intake/wire-schemas';
import {PrivateSpatialGuard} from '../spatial/private-spatial.guard';

const param=(name:string)=>ApiParam({name,schema:{type:'string',format:'uuid'}});
function noQuery(request:Request){if(new URL(request.originalUrl,'http://localhost').searchParams.size)
  throw new AppError(422,'CITYGML_QUERY','This private CityGML operation has no query fields.');}

async function citygmlMultipart(request:Request){
  const type=request.headers['content-type'];
  if(!type?.toLowerCase().startsWith('multipart/form-data;'))throw new AppError(415,'UNSUPPORTED_MEDIA_TYPE','Expected multipart/form-data.');
  const bytes=await readBoundedBytes(request,33*1024*1024,CITYGML_LIMITS.requestMs);
  try{return await new globalThis.Request('http://127.0.0.1/',{method:'POST',headers:{'content-type':type},body:Uint8Array.from(bytes)}).formData();}
  catch{throw new AppError(400,'INVALID_MULTIPART','The multipart body could not be read.');}
}

@ApiTags('private CityGML native reading')
@UseGuards(PrivateSpatialGuard)
@Controller('api/v1/ingestion/cases/:caseId')
export class CityGMLController{
  constructor(@Inject(CityGMLIngestionService)private readonly citygml:CityGMLIngestionService){}
  @Header('Cache-Control','private, no-store') @Header('X-Content-Type-Options','nosniff')
  @Post('citygml') @HttpCode(201) @param('caseId')
  @ApiOperation({operationId:'POST_api_v1_ingestion_cases_caseId_citygml',summary:'Retain unchanged bounded source bytes and queue native CityGML reading'})
  @multipartBody(['file','requestKey','expectedCaseRevision','lineage'],{requestKey:{type:'string',format:'uuid'},
    expectedCaseRevision:{type:'integer',minimum:0},lineage:{type:'string',description:'JSON lineage, including issuer/source URL/geography and permission limitations'}})
  @wireResponse(201,CityGMLRetainReceiptSchema)
  async retain(@Param('caseId')caseId:string,@Req()request:Request){
    const bounds={deadlineAt:Date.now()+CITYGML_LIMITS.requestMs,signal:AbortSignal.timeout(CITYGML_LIMITS.requestMs)};
    noQuery(request);const form=await citygmlMultipart(request),file=form.get('file');
    if(!(file instanceof File))throw new AppError(400,'CITYGML_FILE_REQUIRED','Choose an unchanged source to retain for native CityGML reading.');
    if(!file.size||file.size>CITYGML_LIMITS.originalBytes)throw new AppError(413,'CITYGML_ORIGINAL_SIZE','Retain a nonempty CityGML of at most 32 MiB.');
    const allowed=new Set(['file','requestKey','expectedCaseRevision','lineage']);
    for(const key of form.keys())if(!allowed.has(key)||form.getAll(key).length!==1)
      throw new AppError(422,'CITYGML_FIELDS','Use one value for each declared CityGML field.');
    if(typeof form.get('expectedCaseRevision')!=='string'||!/^(0|[1-9][0-9]*)$/.test(String(form.get('expectedCaseRevision'))))throw new AppError(422,'CITYGML_CASE_PIN','Pin the current source-case revision.');
    let lineage:unknown;try{lineage=JSON.parse(String(form.get('lineage')));}catch{
      throw new AppError(422,'CITYGML_LINEAGE','Lineage must be a JSON object.');}
    const input=CityGMLRetainSchema.parse({requestKey:form.get('requestKey'),expectedCaseRevision:Number(form.get('expectedCaseRevision')),lineage});
    return this.citygml.retain(caseId,input,{name:file.name,bytes:new Uint8Array(await file.arrayBuffer())},bounds);
  }
  @Header('Cache-Control','private, no-store') @Header('X-Content-Type-Options','nosniff')
  @Post('sources/:sourceId/citygml/retries') @HttpCode(202) @param('caseId') @param('sourceId')
  @ApiOperation({operationId:'POST_api_v1_ingestion_cases_caseId_sources_sourceId_citygml_retries',summary:'Retry CityGML inspection under current unchanged source and private access pins'})
  @jsonBody(CityGMLRequestSchema) @wireResponse(202,CityGMLQueueReceiptSchema,[429])
  enqueue(@Param('caseId')caseId:string,@Param('sourceId')sourceId:string,@Req()request:Request){
    const bounds={deadlineAt:Date.now()+CITYGML_LIMITS.requestMs,signal:AbortSignal.timeout(CITYGML_LIMITS.requestMs)};
    noQuery(request);return readBoundedBytes(request,16*1024,CITYGML_LIMITS.requestMs).then(bytes=>{
      let value:unknown;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new AppError(400,'INVALID_JSON','The request must be valid JSON.');}
      return this.citygml.enqueue(caseId,sourceId,value,bounds);});
  }
  @Header('Cache-Control','private, no-store') @Header('X-Content-Type-Options','nosniff')
  @Get('sources/:sourceId/citygml/jobs/:jobId') @param('caseId') @param('sourceId') @param('jobId')
  @ApiOperation({operationId:'GET_api_v1_ingestion_cases_caseId_sources_sourceId_citygml_jobs_jobId',summary:'Read bounded private native summary and recoverable status'})
  @wireResponse(200,CityGMLStatusSchema)
  status(@Param('caseId')caseId:string,@Param('sourceId')sourceId:string,@Param('jobId')jobId:string,@Req()request:Request){
    noQuery(request);return this.citygml.status(caseId,sourceId,jobId);
  }
  @Header('Cache-Control','private, no-store') @Header('X-Content-Type-Options','nosniff')
  @Get('sources/:sourceId/citygml/jobs/:jobId/native') @param('caseId') @param('sourceId') @param('jobId')
  @ApiOperation({operationId:'GET_api_v1_ingestion_cases_caseId_sources_sourceId_citygml_jobs_jobId_native',summary:'Download bounded exact accepted native CityGML result'})
  @wireResponse(200,binary)
  async artifact(@Param('caseId')caseId:string,@Param('sourceId')sourceId:string,@Param('jobId')jobId:string,
    @Req()request:Request,@Res()response:Response){
    noQuery(request);const result=await this.citygml.artifact(caseId,sourceId,jobId);
    response.set({'Content-Type':'application/json','Cache-Control':'private, no-store','Content-Length':String(result.bytes.length),'X-CityGML-Native-Profile':'ulpin-native-citygml/1',
      'X-Content-SHA256':result.sha256});response.send(result.bytes);
  }
  @Header('Cache-Control','private, no-store') @Header('X-Content-Type-Options','nosniff')
  @Get('sources/:sourceId/citygml/original') @param('caseId') @param('sourceId')
  @ApiOperation({operationId:'GET_api_v1_ingestion_cases_caseId_sources_sourceId_citygml_original',summary:'Download unchanged retained original through current CityGML access authority'})
  @wireResponse(200,binary)
  async original(@Param('caseId')caseId:string,@Param('sourceId')sourceId:string,@Req()request:Request,@Res()response:Response){
    noQuery(request);const result=await this.citygml.original(caseId,sourceId);
    response.set({'Content-Type':result.mimeType,'Cache-Control':'private, no-store','Content-Length':String(result.bytes.length),
      'Content-Disposition':'attachment; filename="citygml-original.bin"','X-Content-SHA256':result.sha256});response.send(result.bytes);
  }
}
