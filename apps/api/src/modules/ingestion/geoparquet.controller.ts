import {Controller,Get,Header,HttpCode,Inject,Param,Post,Req,Res,UseGuards} from '@nestjs/common';
import {ApiOperation,ApiParam,ApiTags} from '@nestjs/swagger';
import type {Request,Response} from 'express';
import {GeoParquetRetainSchema,GeoParquetRetainReceiptSchema,GeoParquetRequestSchema,GeoParquetQueueReceiptSchema,
  GeoParquetStatusSchema,GEOPARQUET_LIMITS} from '../../../../../packages/contracts/src/usp/geoparquet-ingestion';
import {GeoParquetIngestionService} from '@ulpin/server/modules/usp/ingestion/geoparquet';
import {AppError} from '@ulpin/server/infrastructure/errors';
import {readBoundedBytes} from '../../common/body';
import {jsonBody,multipartBody,wireResponse,binary} from '../intake/wire-schemas';
import {PrivateSpatialGuard} from '../spatial/private-spatial.guard';

const param=(name:string)=>ApiParam({name,schema:{type:'string',format:'uuid'}});
function noQuery(request:Request){if(new URL(request.originalUrl,'http://localhost').searchParams.size)
  throw new AppError(422,'GEOPARQUET_QUERY','This private GeoParquet operation has no query fields.');}

async function geoparquetMultipart(request:Request){
  const type=request.headers['content-type'];
  if(!type?.toLowerCase().startsWith('multipart/form-data;'))throw new AppError(415,'UNSUPPORTED_MEDIA_TYPE','Expected multipart/form-data.');
  const bytes=await readBoundedBytes(request,33*1024*1024,GEOPARQUET_LIMITS.requestMs);
  try{return await new globalThis.Request('http://127.0.0.1/',{method:'POST',headers:{'content-type':type},body:Uint8Array.from(bytes)}).formData();}
  catch{throw new AppError(400,'INVALID_MULTIPART','The multipart body could not be read.');}
}

@ApiTags('private GeoParquet native reading')
@UseGuards(PrivateSpatialGuard)
@Controller('api/v1/ingestion/cases/:caseId')
export class GeoParquetController{
  constructor(@Inject(GeoParquetIngestionService)private readonly geoparquet:GeoParquetIngestionService){}
  @Header('Cache-Control','private, no-store') @Header('X-Content-Type-Options','nosniff')
  @Post('geoparquet') @HttpCode(201) @param('caseId')
  @ApiOperation({operationId:'POST_api_v1_ingestion_cases_caseId_geoparquet',summary:'Retain unchanged bounded source bytes and queue native GeoParquet reading'})
  @multipartBody(['file','requestKey','expectedCaseRevision','lineage','selection'],{requestKey:{type:'string',format:'uuid'},
    expectedCaseRevision:{type:'integer',minimum:0},lineage:{type:'string',description:'JSON lineage, including issuer/source URL/geography and permission limitations'},selection:{type:'string',description:'JSON object with explicit startRowIndex and rowCount (1..1000)'}})
  @wireResponse(201,GeoParquetRetainReceiptSchema)
  async retain(@Param('caseId')caseId:string,@Req()request:Request){
    const bounds={deadlineAt:Date.now()+GEOPARQUET_LIMITS.requestMs,signal:AbortSignal.timeout(GEOPARQUET_LIMITS.requestMs)};
    noQuery(request);const form=await geoparquetMultipart(request),file=form.get('file');
    if(!(file instanceof File))throw new AppError(400,'GEOPARQUET_FILE_REQUIRED','Choose an unchanged source to retain for native GeoParquet reading.');
    if(!file.size||file.size>GEOPARQUET_LIMITS.originalBytes)throw new AppError(413,'GEOPARQUET_ORIGINAL_SIZE','Retain a nonempty GeoParquet of at most 32 MiB.');
    const allowed=new Set(['file','requestKey','expectedCaseRevision','lineage','selection']);
    for(const key of form.keys())if(!allowed.has(key)||form.getAll(key).length!==1)
      throw new AppError(422,'GEOPARQUET_FIELDS','Use one value for each declared GeoParquet field.');
    if(typeof form.get('expectedCaseRevision')!=='string'||!/^(0|[1-9][0-9]*)$/.test(String(form.get('expectedCaseRevision'))))throw new AppError(422,'GEOPARQUET_CASE_PIN','Pin the current source-case revision.');
    let lineage:unknown,selection:unknown;try{lineage=JSON.parse(String(form.get('lineage')));selection=JSON.parse(String(form.get('selection')));}catch{
      throw new AppError(422,'GEOPARQUET_LINEAGE','Lineage and selection must be JSON objects.');}
    const input=GeoParquetRetainSchema.parse({requestKey:form.get('requestKey'),expectedCaseRevision:Number(form.get('expectedCaseRevision')),lineage,selection});
    return this.geoparquet.retain(caseId,input,{name:file.name,bytes:new Uint8Array(await file.arrayBuffer())},bounds);
  }
  @Header('Cache-Control','private, no-store') @Header('X-Content-Type-Options','nosniff')
  @Post('sources/:sourceId/geoparquet/retries') @HttpCode(202) @param('caseId') @param('sourceId')
  @ApiOperation({operationId:'POST_api_v1_ingestion_cases_caseId_sources_sourceId_geoparquet_retries',summary:'Retry a bounded GeoParquet row selection or exact accepted continuation under current private source pins'})
  @jsonBody(GeoParquetRequestSchema) @wireResponse(202,GeoParquetQueueReceiptSchema,[429])
  enqueue(@Param('caseId')caseId:string,@Param('sourceId')sourceId:string,@Req()request:Request){
    const bounds={deadlineAt:Date.now()+GEOPARQUET_LIMITS.requestMs,signal:AbortSignal.timeout(GEOPARQUET_LIMITS.requestMs)};
    noQuery(request);return readBoundedBytes(request,16*1024,GEOPARQUET_LIMITS.requestMs).then(bytes=>{
      let value:unknown;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new AppError(400,'INVALID_JSON','The request must be valid JSON.');}
      return this.geoparquet.enqueue(caseId,sourceId,value,bounds);});
  }
  @Header('Cache-Control','private, no-store') @Header('X-Content-Type-Options','nosniff')
  @Get('sources/:sourceId/geoparquet/jobs/:jobId') @param('caseId') @param('sourceId') @param('jobId')
  @ApiOperation({operationId:'GET_api_v1_ingestion_cases_caseId_sources_sourceId_geoparquet_jobs_jobId',summary:'Read bounded private native summary and recoverable status'})
  @wireResponse(200,GeoParquetStatusSchema)
  status(@Param('caseId')caseId:string,@Param('sourceId')sourceId:string,@Param('jobId')jobId:string,@Req()request:Request){
    noQuery(request);return this.geoparquet.status(caseId,sourceId,jobId);
  }
  @Header('Cache-Control','private, no-store') @Header('X-Content-Type-Options','nosniff')
  @Get('sources/:sourceId/geoparquet/jobs/:jobId/native') @param('caseId') @param('sourceId') @param('jobId')
  @ApiOperation({operationId:'GET_api_v1_ingestion_cases_caseId_sources_sourceId_geoparquet_jobs_jobId_native',summary:'Download bounded exact accepted native GeoParquet result'})
  @wireResponse(200,binary)
  async artifact(@Param('caseId')caseId:string,@Param('sourceId')sourceId:string,@Param('jobId')jobId:string,
    @Req()request:Request,@Res()response:Response){
    noQuery(request);const result=await this.geoparquet.artifact(caseId,sourceId,jobId);
    response.set({'Content-Type':'application/json','Cache-Control':'private, no-store','Content-Length':String(result.bytes.length),'X-GeoParquet-Native-Profile':'usp-native-geoparquet/1',
      'X-Content-SHA256':result.sha256});response.send(result.bytes);
  }
  @Header('Cache-Control','private, no-store') @Header('X-Content-Type-Options','nosniff')
  @Get('sources/:sourceId/geoparquet/original') @param('caseId') @param('sourceId')
  @ApiOperation({operationId:'GET_api_v1_ingestion_cases_caseId_sources_sourceId_geoparquet_original',summary:'Download unchanged retained original through current GeoParquet access authority'})
  @wireResponse(200,binary)
  async original(@Param('caseId')caseId:string,@Param('sourceId')sourceId:string,@Req()request:Request,@Res()response:Response){
    noQuery(request);const result=await this.geoparquet.original(caseId,sourceId);
    response.set({'Content-Type':result.mimeType,'Cache-Control':'private, no-store','Content-Length':String(result.bytes.length),
      'Content-Disposition':'attachment; filename="geoparquet-original.bin"','X-Content-SHA256':result.sha256});response.send(result.bytes);
  }
}
