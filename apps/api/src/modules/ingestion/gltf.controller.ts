import {Controller,Get,Header,HttpCode,Inject,Param,Post,Req,Res,UseGuards} from '@nestjs/common';
import {ApiOperation,ApiParam,ApiTags} from '@nestjs/swagger';
import type {Request,Response} from 'express';
import {GltfRetainSchema,GltfRetainReceiptSchema,GltfRequestSchema,GltfQueueReceiptSchema,
  GltfStatusSchema,GLTF_LIMITS} from '../../../../../packages/contracts/src/usp/gltf-ingestion';
import {GltfIngestionService} from '@ulpin/server/modules/usp/ingestion/gltf';
import {AppError} from '@ulpin/server/infrastructure/errors';
import {readBoundedBytes} from '../../common/body';
import {jsonBody,multipartBody,wireResponse,binary} from '../intake/wire-schemas';
import {PrivateSpatialGuard} from '../spatial/private-spatial.guard';

const param=(name:string)=>ApiParam({name,schema:{type:'string',format:'uuid'}});
function noQuery(request:Request){if(new URL(request.originalUrl,'http://localhost').searchParams.size)
  throw new AppError(422,'GLTF_QUERY','This private Gltf operation has no query fields.');}

async function gltfMultipart(request:Request){
  const type=request.headers['content-type'];
  if(!type?.toLowerCase().startsWith('multipart/form-data;'))throw new AppError(415,'UNSUPPORTED_MEDIA_TYPE','Expected multipart/form-data.');
  const bytes=await readBoundedBytes(request,17*1024*1024,GLTF_LIMITS.requestMs);
  try{return await new globalThis.Request('http://127.0.0.1/',{method:'POST',headers:{'content-type':type},body:Uint8Array.from(bytes)}).formData();}
  catch{throw new AppError(400,'INVALID_MULTIPART','The multipart body could not be read.');}
}

@ApiTags('private Gltf native reading')
@UseGuards(PrivateSpatialGuard)
@Controller('api/v1/ingestion/cases/:caseId')
export class GltfController{
  constructor(@Inject(GltfIngestionService)private readonly gltf:GltfIngestionService){}
  @Header('Cache-Control','private, no-store') @Header('X-Content-Type-Options','nosniff')
  @Post('gltf') @HttpCode(201) @param('caseId')
  @ApiOperation({operationId:'POST_api_v1_ingestion_cases_caseId_gltf',summary:'Retain unchanged bounded source bytes and queue native Gltf reading'})
  @multipartBody(['file','requestKey','expectedCaseRevision','lineage'],{requestKey:{type:'string',format:'uuid'},
    expectedCaseRevision:{type:'integer',minimum:0},lineage:{type:'string',description:'JSON lineage, including issuer/source URL/geography and permission limitations'},
    sceneIndex:{type:'integer',minimum:0,maximum:9999,description:'Optional explicit scene; absence never selects an undeclared scene'}})
  @wireResponse(201,GltfRetainReceiptSchema)
  async retain(@Param('caseId')caseId:string,@Req()request:Request){
    const bounds={deadlineAt:Date.now()+GLTF_LIMITS.requestMs,signal:AbortSignal.timeout(GLTF_LIMITS.requestMs)};
    noQuery(request);const form=await gltfMultipart(request),file=form.get('file');
    if(!(file instanceof File))throw new AppError(400,'GLTF_FILE_REQUIRED','Choose an unchanged source to retain for native Gltf reading.');
    if(!file.size||file.size>GLTF_LIMITS.originalBytes)throw new AppError(413,'GLTF_ORIGINAL_SIZE','Retain a nonempty Gltf of at most 16 MiB.');
    const allowed=new Set(['file','requestKey','expectedCaseRevision','lineage','sceneIndex']);
    for(const key of form.keys())if(!allowed.has(key)||form.getAll(key).length!==1)
      throw new AppError(422,'GLTF_FIELDS','Use one value for each declared Gltf field.');
    if(typeof form.get('expectedCaseRevision')!=='string'||!/^(0|[1-9][0-9]*)$/.test(String(form.get('expectedCaseRevision'))))throw new AppError(422,'GLTF_CASE_PIN','Pin the current source-case revision.');
    let lineage:unknown;try{lineage=JSON.parse(String(form.get('lineage')));}catch{
      throw new AppError(422,'GLTF_LINEAGE','Lineage must be a JSON object.');}
    if(form.has('sceneIndex')&&!/^(0|[1-9][0-9]*)$/.test(String(form.get('sceneIndex'))))throw new AppError(422,'GLTF_SCENE_PIN','Choose an explicit nonnegative scene index.');
    const input=GltfRetainSchema.parse({requestKey:form.get('requestKey'),expectedCaseRevision:Number(form.get('expectedCaseRevision')),lineage,
      ...(form.has('sceneIndex')?{sceneIndex:Number(form.get('sceneIndex'))}:{})});
    return this.gltf.retain(caseId,input,{name:file.name,bytes:new Uint8Array(await file.arrayBuffer())},bounds);
  }
  @Header('Cache-Control','private, no-store') @Header('X-Content-Type-Options','nosniff')
  @Post('sources/:sourceId/gltf/retries') @HttpCode(202) @param('caseId') @param('sourceId')
  @ApiOperation({operationId:'POST_api_v1_ingestion_cases_caseId_sources_sourceId_gltf_retries',summary:'Retry Gltf inspection under current unchanged source and private access pins'})
  @jsonBody(GltfRequestSchema) @wireResponse(202,GltfQueueReceiptSchema,[429])
  enqueue(@Param('caseId')caseId:string,@Param('sourceId')sourceId:string,@Req()request:Request){
    const bounds={deadlineAt:Date.now()+GLTF_LIMITS.requestMs,signal:AbortSignal.timeout(GLTF_LIMITS.requestMs)};
    noQuery(request);return readBoundedBytes(request,16*1024,GLTF_LIMITS.requestMs).then(bytes=>{
      let value:unknown;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new AppError(400,'INVALID_JSON','The request must be valid JSON.');}
      return this.gltf.enqueue(caseId,sourceId,value,bounds);});
  }
  @Header('Cache-Control','private, no-store') @Header('X-Content-Type-Options','nosniff')
  @Get('sources/:sourceId/gltf/jobs/:jobId') @param('caseId') @param('sourceId') @param('jobId')
  @ApiOperation({operationId:'GET_api_v1_ingestion_cases_caseId_sources_sourceId_gltf_jobs_jobId',summary:'Read bounded private native summary and recoverable status'})
  @wireResponse(200,GltfStatusSchema)
  status(@Param('caseId')caseId:string,@Param('sourceId')sourceId:string,@Param('jobId')jobId:string,@Req()request:Request){
    noQuery(request);return this.gltf.status(caseId,sourceId,jobId);
  }
  @Header('Cache-Control','private, no-store') @Header('X-Content-Type-Options','nosniff')
  @Get('sources/:sourceId/gltf/jobs/:jobId/native') @param('caseId') @param('sourceId') @param('jobId')
  @ApiOperation({operationId:'GET_api_v1_ingestion_cases_caseId_sources_sourceId_gltf_jobs_jobId_native',summary:'Download bounded exact accepted native Gltf result'})
  @wireResponse(200,binary)
  async artifact(@Param('caseId')caseId:string,@Param('sourceId')sourceId:string,@Param('jobId')jobId:string,
    @Req()request:Request,@Res()response:Response){
    noQuery(request);const result=await this.gltf.artifact(caseId,sourceId,jobId);
    response.set({'Content-Type':'application/json','Cache-Control':'private, no-store','Content-Length':String(result.bytes.length),'X-Gltf-Native-Profile':'gltf-local-inspection/1',
      'X-Content-SHA256':result.sha256});response.send(result.bytes);
  }
  @Header('Cache-Control','private, no-store') @Header('X-Content-Type-Options','nosniff')
  @Get('sources/:sourceId/gltf/original') @param('caseId') @param('sourceId')
  @ApiOperation({operationId:'GET_api_v1_ingestion_cases_caseId_sources_sourceId_gltf_original',summary:'Download unchanged retained original through current Gltf access authority'})
  @wireResponse(200,binary)
  async original(@Param('caseId')caseId:string,@Param('sourceId')sourceId:string,@Req()request:Request,@Res()response:Response){
    noQuery(request);const result=await this.gltf.original(caseId,sourceId);
    response.set({'Content-Type':result.mimeType,'Cache-Control':'private, no-store','Content-Length':String(result.bytes.length),
      'Content-Disposition':'attachment; filename="gltf-original.bin"','X-Content-SHA256':result.sha256});response.send(result.bytes);
  }
}
