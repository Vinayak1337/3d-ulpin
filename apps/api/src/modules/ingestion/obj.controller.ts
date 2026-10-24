import {Controller,Get,Header,HttpCode,Inject,Param,Post,Req,Res,UseGuards} from '@nestjs/common';
import {ApiOperation,ApiParam,ApiTags} from '@nestjs/swagger';
import type {Request,Response} from 'express';
import {ObjRetainSchema,ObjRetainReceiptSchema,ObjRequestSchema,ObjQueueReceiptSchema,
  ObjStatusSchema,OBJ_LIMITS} from '../../../../../packages/contracts/src/usp/obj-ingestion';
import {ObjIngestionService} from '@ulpin/server/modules/usp/ingestion/obj';
import {AppError} from '@ulpin/server/infrastructure/errors';
import {readBoundedBytes} from '../../common/body';
import {jsonBody,multipartBody,wireResponse,binary} from '../intake/wire-schemas';
import {PrivateSpatialGuard} from '../spatial/private-spatial.guard';

const param=(name:string)=>ApiParam({name,schema:{type:'string',format:'uuid'}});
function noQuery(request:Request){if(new URL(request.originalUrl,'http://localhost').searchParams.size)
  throw new AppError(422,'OBJ_QUERY','This private Obj operation has no query fields.');}

async function objMultipart(request:Request){
  const type=request.headers['content-type'];
  if(!type?.toLowerCase().startsWith('multipart/form-data;'))throw new AppError(415,'UNSUPPORTED_MEDIA_TYPE','Expected multipart/form-data.');
  const bytes=await readBoundedBytes(request,17*1024*1024,OBJ_LIMITS.requestMs);
  try{return await new globalThis.Request('http://127.0.0.1/',{method:'POST',headers:{'content-type':type},body:Uint8Array.from(bytes)}).formData();}
  catch{throw new AppError(400,'INVALID_MULTIPART','The multipart body could not be read.');}
}

@ApiTags('private Obj native reading')
@UseGuards(PrivateSpatialGuard)
@Controller('api/v1/ingestion/cases/:caseId')
export class ObjController{
  constructor(@Inject(ObjIngestionService)private readonly obj:ObjIngestionService){}
  @Header('Cache-Control','private, no-store') @Header('X-Content-Type-Options','nosniff')
  @Post('obj') @HttpCode(201) @param('caseId')
  @ApiOperation({operationId:'POST_api_v1_ingestion_cases_caseId_obj',summary:'Retain unchanged bounded source bytes and queue native Obj reading'})
  @multipartBody(['file','requestKey','expectedCaseRevision','lineage'],{requestKey:{type:'string',format:'uuid'},
    expectedCaseRevision:{type:'integer',minimum:0},lineage:{type:'string',description:'JSON lineage, including issuer/source URL/geography and permission limitations'}})
  @wireResponse(201,ObjRetainReceiptSchema)
  async retain(@Param('caseId')caseId:string,@Req()request:Request){
    const bounds={deadlineAt:Date.now()+OBJ_LIMITS.requestMs,signal:AbortSignal.timeout(OBJ_LIMITS.requestMs)};
    noQuery(request);const form=await objMultipart(request),file=form.get('file');
    if(!(file instanceof File))throw new AppError(400,'OBJ_FILE_REQUIRED','Choose an unchanged source to retain for native Obj reading.');
    if(!file.size||file.size>OBJ_LIMITS.originalBytes)throw new AppError(413,'OBJ_ORIGINAL_SIZE','Retain a nonempty Obj of at most 16 MiB.');
    const allowed=new Set(['file','requestKey','expectedCaseRevision','lineage']);
    for(const key of form.keys())if(!allowed.has(key)||form.getAll(key).length!==1)
      throw new AppError(422,'OBJ_FIELDS','Use one value for each declared Obj field.');
    if(typeof form.get('expectedCaseRevision')!=='string'||!/^(0|[1-9][0-9]*)$/.test(String(form.get('expectedCaseRevision'))))throw new AppError(422,'OBJ_CASE_PIN','Pin the current source-case revision.');
    let lineage:unknown;try{lineage=JSON.parse(String(form.get('lineage')));}catch{
      throw new AppError(422,'OBJ_LINEAGE','Lineage must be a JSON object.');}
    const input=ObjRetainSchema.parse({requestKey:form.get('requestKey'),expectedCaseRevision:Number(form.get('expectedCaseRevision')),lineage});
    return this.obj.retain(caseId,input,{name:file.name,bytes:new Uint8Array(await file.arrayBuffer())},bounds);
  }
  @Header('Cache-Control','private, no-store') @Header('X-Content-Type-Options','nosniff')
  @Post('sources/:sourceId/obj/retries') @HttpCode(202) @param('caseId') @param('sourceId')
  @ApiOperation({operationId:'POST_api_v1_ingestion_cases_caseId_sources_sourceId_obj_retries',summary:'Retry Obj inspection under current unchanged source and private access pins'})
  @jsonBody(ObjRequestSchema) @wireResponse(202,ObjQueueReceiptSchema,[429])
  enqueue(@Param('caseId')caseId:string,@Param('sourceId')sourceId:string,@Req()request:Request){
    const bounds={deadlineAt:Date.now()+OBJ_LIMITS.requestMs,signal:AbortSignal.timeout(OBJ_LIMITS.requestMs)};
    noQuery(request);return readBoundedBytes(request,16*1024,OBJ_LIMITS.requestMs).then(bytes=>{
      let value:unknown;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new AppError(400,'INVALID_JSON','The request must be valid JSON.');}
      return this.obj.enqueue(caseId,sourceId,value,bounds);});
  }
  @Header('Cache-Control','private, no-store') @Header('X-Content-Type-Options','nosniff')
  @Get('sources/:sourceId/obj/jobs/:jobId') @param('caseId') @param('sourceId') @param('jobId')
  @ApiOperation({operationId:'GET_api_v1_ingestion_cases_caseId_sources_sourceId_obj_jobs_jobId',summary:'Read bounded private native summary and recoverable status'})
  @wireResponse(200,ObjStatusSchema)
  status(@Param('caseId')caseId:string,@Param('sourceId')sourceId:string,@Param('jobId')jobId:string,@Req()request:Request){
    noQuery(request);return this.obj.status(caseId,sourceId,jobId);
  }
  @Header('Cache-Control','private, no-store') @Header('X-Content-Type-Options','nosniff')
  @Get('sources/:sourceId/obj/jobs/:jobId/native') @param('caseId') @param('sourceId') @param('jobId')
  @ApiOperation({operationId:'GET_api_v1_ingestion_cases_caseId_sources_sourceId_obj_jobs_jobId_native',summary:'Download bounded exact accepted native Obj result'})
  @wireResponse(200,binary)
  async artifact(@Param('caseId')caseId:string,@Param('sourceId')sourceId:string,@Param('jobId')jobId:string,
    @Req()request:Request,@Res()response:Response){
    noQuery(request);const result=await this.obj.artifact(caseId,sourceId,jobId);
    response.set({'Content-Type':'application/json','Cache-Control':'private, no-store','Content-Length':String(result.bytes.length),'X-Obj-Native-Profile':'obj-source-context/1',
      'X-Content-SHA256':result.sha256});response.send(result.bytes);
  }
  @Header('Cache-Control','private, no-store') @Header('X-Content-Type-Options','nosniff')
  @Get('sources/:sourceId/obj/original') @param('caseId') @param('sourceId')
  @ApiOperation({operationId:'GET_api_v1_ingestion_cases_caseId_sources_sourceId_obj_original',summary:'Download unchanged retained original through current Obj access authority'})
  @wireResponse(200,binary)
  async original(@Param('caseId')caseId:string,@Param('sourceId')sourceId:string,@Req()request:Request,@Res()response:Response){
    noQuery(request);const result=await this.obj.original(caseId,sourceId);
    response.set({'Content-Type':result.mimeType,'Cache-Control':'private, no-store','Content-Length':String(result.bytes.length),
      'Content-Disposition':'attachment; filename="obj-original.bin"','X-Content-SHA256':result.sha256});response.send(result.bytes);
  }
}
