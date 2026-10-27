import {Controller,HttpCode,Inject,Post,Req,Res,UseFilters,UseGuards} from '@nestjs/common';
import {ApiBody,ApiOperation,ApiResponse,ApiTags} from '@nestjs/swagger';
import type {Request,Response} from 'express';
import {SURVEY_REPORT_LIMITS,SurveyReportRequestSchema,SurveyReportContextSchema} from '../../../../../packages/contracts/src/survey-report';
import {SurveyReportService} from '@ulpin/server/modules/usp/ingestion/survey-report';
import {localRequestContext} from '@ulpin/server/modules/usp/principal';
import {AppError} from '@ulpin/server/infrastructure/errors';
import {readBoundedBytes} from '../../common/body';
import {requestId} from '../../common/request-context';
import {PrivateSpatialGuard} from '../spatial/private-spatial.guard';
import {EvidenceExceptionFilter,uspEnvelope} from './evidence.http';
import {envelopeSchema,requestApiSchema,evidenceSchemas,openApiSchema} from './evidence.schemas';

const errorSchema=openApiSchema(evidenceSchemas.error);
@ApiTags('USP literal survey report')
@UseFilters(EvidenceExceptionFilter)
@UseGuards(PrivateSpatialGuard)
@Controller('api/v1/usp/evidence/survey-report')
export class SurveyReportController{
  constructor(@Inject(SurveyReportService) private readonly service:SurveyReportService){}
  @Post('context')
  @HttpCode(200)
  @ApiOperation({operationId:'POST_api_v1_usp_evidence_survey_report_context',
    summary:'Inspect one private accepted native TEXT LP360 survey report as source literals; frames, comparison, accuracy and learning remain unqualified'})
  @ApiBody({required:true,description:'Strict JSON exact document pins; at most 4 KiB received bytes; no caller table or URL',
    schema:requestApiSchema(SurveyReportRequestSchema)})
  @ApiResponse({status:200,description:'Cited source rows/statistics and actionable gaps; needs_input',schema:envelopeSchema(SurveyReportContextSchema),
    headers:{'Cache-Control':{schema:{type:'string',enum:['private, no-store']}}}})
  @ApiResponse({status:400,description:'Invalid strict request',schema:errorSchema})
  @ApiResponse({status:403,description:'Private Host/Origin or current operator access denied',schema:openApiSchema(evidenceSchemas.forbiddenError)})
  @ApiResponse({status:404,description:'Exact accepted document unavailable',schema:errorSchema})
  @ApiResponse({status:408,description:'Request body deadline',schema:errorSchema})
  @ApiResponse({status:409,description:'Current source/job/reader/access/attempt pins changed',schema:errorSchema})
  @ApiResponse({status:413,description:'Bounded request/result/table/response limit',schema:errorSchema})
  @ApiResponse({status:422,description:'Unsupported or ambiguous layout, or exact result integrity failure',schema:errorSchema})
  @ApiResponse({status:503,description:'Bounded storage read unavailable or expired',schema:errorSchema})
  @ApiResponse({status:504,description:'Current authority database deadline',schema:errorSchema})
  async context(@Req() request:Request,@Res({passthrough:true}) response:Response){
    response.setHeader('Cache-Control','private, no-store');
    const bytes=await readBoundedBytes(request,SURVEY_REPORT_LIMITS.requestBytes,5000);
    let raw:unknown;
    try{raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
    catch{throw new AppError(400,'SURVEY_REPORT_JSON','A strict JSON document selection is required.');}
    const input=SurveyReportRequestSchema.parse(raw);
    const data=await this.service.inspect(localRequestContext(requestId(request)),input);
    return uspEnvelope(request,{kind:'intake',workspaceId:data.document.caseId,version:data.document.caseRevision+1},data);
  }
}
