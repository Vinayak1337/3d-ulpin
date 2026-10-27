import {Controller,Get,Header,HttpCode,Inject,Param,Post,Req,Res,UseGuards} from '@nestjs/common';
import {ApiOperation,ApiParam,ApiTags} from '@nestjs/swagger';
import type {Request,Response} from 'express';
import {KMLRetainSchema,KMLRetainReceiptSchema,KMLRequestSchema,KMLQueueReceiptSchema,
  KMLStatusSchema,KML_LIMITS} from '../../../../../packages/contracts/src/usp/kml-ingestion';
import {KMLIngestionService} from '@ulpin/server/modules/usp/ingestion/kml';
import {AppError} from '@ulpin/server/infrastructure/errors';
import {readBoundedBytes} from '../../common/body';
import {jsonBody,multipartBody,wireResponse,binary} from '../intake/wire-schemas';
import {PrivateSpatialGuard} from '../spatial/private-spatial.guard';

const param=(name:string)=>ApiParam({name,schema:{type:'string',format:'uuid'}});
function noQuery(request:Request){if(new URL(request.originalUrl,'http://localhost').searchParams.size)
  throw new AppError(422,'KML_QUERY','This private KML operation has no query fields.');}

async function kmlMultipart(request:Request){
  const type=request.headers['content-type'];
  if(!type?.toLowerCase().startsWith('multipart/form-data;'))throw new AppError(415,'UNSUPPORTED_MEDIA_TYPE','Expected multipart/form-data.');
  const bytes=await readBoundedBytes(request,17*1024*1024,KML_LIMITS.requestMs);
  try{return await new globalThis.Request('http://127.0.0.1/',{method:'POST',headers:{'content-type':type},body:Uint8Array.from(bytes)}).formData();}
  catch{throw new AppError(400,'INVALID_MULTIPART','The multipart body could not be read.');}
}

@ApiTags('private KML native reading')
@UseGuards(PrivateSpatialGuard)
@Controller('api/v1/ingestion/cases/:caseId')
export class KMLController{
  constructor(@Inject(KMLIngestionService)private readonly kml:KMLIngestionService){}
  @Header('Cache-Control','private, no-store') @Header('X-Content-Type-Options','nosniff')
  @Post('kml') @HttpCode(201) @param('caseId')
  @ApiOperation({operationId:'POST_api_v1_ingestion_cases_caseId_kml',summary:'Retain unchanged bounded source bytes and queue native KML reading'})
  @multipartBody(['file','requestKey','expectedCaseRevision','lineage'],{requestKey:{type:'string',format:'uuid'},
    expectedCaseRevision:{type:'integer',minimum:0},lineage:{type:'string',description:'JSON lineage, including issuer/source URL/geography and permission limitations'}})
  @wireResponse(201,KMLRetainReceiptSchema)
  async retain(@Param('caseId')caseId:string,@Req()request:Request){
    const bounds={deadlineAt:Date.now()+KML_LIMITS.requestMs,signal:AbortSignal.timeout(KML_LIMITS.requestMs)};
    noQuery(request);const form=await kmlMultipart(request),file=form.get('file');
    if(!(file instanceof File))throw new AppError(400,'KML_FILE_REQUIRED','Choose an unchanged source to retain for native KML reading.');
    if(!file.size||file.size>KML_LIMITS.originalBytes)throw new AppError(413,'KML_ORIGINAL_SIZE','Retain a nonempty KML of at most 16 MiB.');
    const allowed=new Set(['file','requestKey','expectedCaseRevision','lineage']);
    for(const key of form.keys())if(!allowed.has(key)||form.getAll(key).length!==1)
      throw new AppError(422,'KML_FIELDS','Use one value for each declared KML field.');
    if(typeof form.get('expectedCaseRevision')!=='string'||!/^(0|[1-9][0-9]*)$/.test(String(form.get('expectedCaseRevision'))))throw new AppError(422,'KML_CASE_PIN','Pin the current source-case revision.');
    let lineage:unknown;try{lineage=JSON.parse(String(form.get('lineage')));}catch{
      throw new AppError(422,'KML_LINEAGE','Lineage must be a JSON object.');}
    const input=KMLRetainSchema.parse({requestKey:form.get('requestKey'),expectedCaseRevision:Number(form.get('expectedCaseRevision')),lineage});
    return this.kml.retain(caseId,input,{name:file.name,bytes:new Uint8Array(await file.arrayBuffer())},bounds);
  }
  @Header('Cache-Control','private, no-store') @Header('X-Content-Type-Options','nosniff')
  @Post('sources/:sourceId/kml/retries') @HttpCode(202) @param('caseId') @param('sourceId')
  @ApiOperation({operationId:'POST_api_v1_ingestion_cases_caseId_sources_sourceId_kml_retries',summary:'Retry KML/KMZ inspection under current source and exact optional member pins'})
  @jsonBody(KMLRequestSchema) @wireResponse(202,KMLQueueReceiptSchema,[429])
  enqueue(@Param('caseId')caseId:string,@Param('sourceId')sourceId:string,@Req()request:Request){
    const bounds={deadlineAt:Date.now()+KML_LIMITS.requestMs,signal:AbortSignal.timeout(KML_LIMITS.requestMs)};
    noQuery(request);return readBoundedBytes(request,16*1024,KML_LIMITS.requestMs).then(bytes=>{
      let value:unknown;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new AppError(400,'INVALID_JSON','The request must be valid JSON.');}
      return this.kml.enqueue(caseId,sourceId,value,bounds);});
  }
  @Header('Cache-Control','private, no-store') @Header('X-Content-Type-Options','nosniff')
  @Get('sources/:sourceId/kml/jobs/:jobId') @param('caseId') @param('sourceId') @param('jobId')
  @ApiOperation({operationId:'GET_api_v1_ingestion_cases_caseId_sources_sourceId_kml_jobs_jobId',summary:'Read bounded private native summary and recoverable status'})
  @wireResponse(200,KMLStatusSchema)
  status(@Param('caseId')caseId:string,@Param('sourceId')sourceId:string,@Param('jobId')jobId:string,@Req()request:Request){
    noQuery(request);return this.kml.status(caseId,sourceId,jobId);
  }
  @Header('Cache-Control','private, no-store') @Header('X-Content-Type-Options','nosniff')
  @Get('sources/:sourceId/kml/jobs/:jobId/native') @param('caseId') @param('sourceId') @param('jobId')
  @ApiOperation({operationId:'GET_api_v1_ingestion_cases_caseId_sources_sourceId_kml_jobs_jobId_native',summary:'Download bounded exact accepted native KML result'})
  @wireResponse(200,binary)
  async artifact(@Param('caseId')caseId:string,@Param('sourceId')sourceId:string,@Param('jobId')jobId:string,
    @Req()request:Request,@Res()response:Response){
    noQuery(request);const result=await this.kml.artifact(caseId,sourceId,jobId);
    response.set({'Content-Type':'application/json','Cache-Control':'private, no-store','Content-Length':String(result.bytes.length),'X-KML-Native-Profile':'kml-native-inspection/1',
      'X-Content-SHA256':result.sha256});response.send(result.bytes);
  }
  @Header('Cache-Control','private, no-store') @Header('X-Content-Type-Options','nosniff')
  @Get('sources/:sourceId/kml/original') @param('caseId') @param('sourceId')
  @ApiOperation({operationId:'GET_api_v1_ingestion_cases_caseId_sources_sourceId_kml_original',summary:'Download unchanged retained original through current KML access authority'})
  @wireResponse(200,binary)
  async original(@Param('caseId')caseId:string,@Param('sourceId')sourceId:string,@Req()request:Request,@Res()response:Response){
    noQuery(request);const result=await this.kml.original(caseId,sourceId);
    response.set({'Content-Type':result.mimeType,'Cache-Control':'private, no-store','Content-Length':String(result.bytes.length),
      'Content-Disposition':'attachment; filename="kml-original.bin"','X-Content-SHA256':result.sha256});response.send(result.bytes);
  }
}
