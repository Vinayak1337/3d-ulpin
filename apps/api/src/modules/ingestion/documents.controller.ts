import {Controller,Get,Header,HttpCode,Inject,Param,Post,Query,Req,UseGuards} from '@nestjs/common';
import {ApiOperation,ApiParam,ApiQuery} from '@nestjs/swagger';
import type {Request} from 'express';
import {DocumentRetainSchema,DocumentRetrySchema,DocumentReceiptSchema,DocumentStatusSchema} from '@ulpin/contracts/usp';
import {DocumentIngestionService} from '@ulpin/server/modules/usp/ingestion/documents';
import {AppError} from '@ulpin/server/infrastructure/errors';
import {readJsonBody,readMultipartBody,JSON_BODY_LIMIT,MULTIPART_BODY_LIMIT} from '../../common/body';
import {jsonBody,multipartBody,wireResponse} from '../intake/wire-schemas';
import {PrivateSpatialGuard} from '../spatial/private-spatial.guard';
const param=(name:string)=>ApiParam({name,schema:{type:'string',format:'uuid'}});
@UseGuards(PrivateSpatialGuard)
@Controller('api/v1/ingestion')
export class DocumentsController{
  constructor(@Inject(DocumentIngestionService) private readonly documents:DocumentIngestionService){}
  @Post('cases/:caseId/documents')
  @HttpCode(201) @param('caseId')
  @ApiOperation({operationId:'POST_api_v1_ingestion_cases_caseId_documents',summary:'Retain an unchanged original before queued source-bound native/model extraction'})
  @multipartBody(['file','requestKey','expectedCaseRevision'],{requestKey:{type:'string',format:'uuid'},expectedCaseRevision:{type:'integer',minimum:0},
    mode:{type:'string',enum:['native_only','propose']},familyId:{type:'string',format:'uuid'},expectedSourceRevision:{type:'integer',minimum:1}})
  @wireResponse(201,DocumentReceiptSchema)
  async retain(@Param('caseId') caseId:string,@Req() request:Request){
    const form=await readMultipartBody(request,MULTIPART_BODY_LIMIT),file=form.get('file');
    if(!(file instanceof File))throw new AppError(400,'DOCUMENT_FILE_REQUIRED','Choose an original document.');
    const allowed=new Set(['file','requestKey','expectedCaseRevision','mode','familyId','expectedSourceRevision']);
    for(const key of form.keys())if(!allowed.has(key)||form.getAll(key).length!==1)throw new AppError(422,'DOCUMENT_FIELDS','Use one value for each allowed receipt field.');
    if(!form.has('expectedCaseRevision'))throw new AppError(422,'DOCUMENT_CASE_PIN','Pin the current source-case revision.');
    const input=DocumentRetainSchema.parse({requestKey:form.get('requestKey'),expectedCaseRevision:Number(form.get('expectedCaseRevision')),
      ...(form.has('mode')?{mode:form.get('mode')}:{}),...(form.has('familyId')?{familyId:form.get('familyId')}:{}),
      ...(form.has('expectedSourceRevision')?{expectedSourceRevision:Number(form.get('expectedSourceRevision'))}:{})});
    return this.documents.retain(caseId,input,{name:file.name,bytes:new Uint8Array(await file.arrayBuffer())});
  }
  @Get('cases/:caseId/sources/:sourceId/documents/jobs/:jobId')
  @Header('Cache-Control','private, no-store')
  @param('caseId') @param('sourceId') @param('jobId')
  @ApiQuery({name:'page',required:false,schema:{type:'integer',minimum:0,maximum:399}})
  @ApiQuery({name:'ocrPage',required:false,schema:{type:'integer',minimum:0,maximum:2}})
  @ApiOperation({operationId:'GET_api_v1_ingestion_cases_caseId_sources_sourceId_documents_jobs_jobId',summary:'Read bounded native/OCR observations, selected member GIS inspection and proposed fields under current source/access/policy pins'})
  @wireResponse(200,DocumentStatusSchema)
  status(@Param('caseId') caseId:string,@Param('sourceId') sourceId:string,@Param('jobId') jobId:string,@Query('page') page?:string,
    @Query('ocrPage') ocrPage?:string){
    return this.documents.status(caseId,sourceId,jobId,page===undefined?0:Number(page),ocrPage===undefined?0:Number(ocrPage));
  }
  @Post('cases/:caseId/sources/:sourceId/documents/retry')
  @HttpCode(201) @param('caseId') @param('sourceId')
  @ApiOperation({operationId:'POST_api_v1_ingestion_cases_caseId_sources_sourceId_documents_retry',summary:'Queue a retry, PDF page/region OCR or exactly pinned GeoJSON archive member inspection against the unchanged current original'})
  @jsonBody(DocumentRetrySchema) @wireResponse(201,DocumentReceiptSchema)
  async retry(@Param('caseId') caseId:string,@Param('sourceId') sourceId:string,@Req() request:Request){
    return this.documents.retry(caseId,sourceId,DocumentRetrySchema.parse(await readJsonBody(request,JSON_BODY_LIMIT)));
  }
}
