import {Controller,Get,Header,HttpCode,Inject,Param,Post,Req,UseGuards} from '@nestjs/common';
import {ApiOperation,ApiParam,ApiQuery} from '@nestjs/swagger';
import type {Request} from 'express';
import {DOCUMENT_CLAIMS_LIMITS,DocumentClaimsReviewRequestSchema,DocumentClaimReviewSchema} from '../../../../../packages/contracts/src/usp/document-claims';
import {DocumentClaimsService} from '@ulpin/server/modules/usp/ingestion/document-claims';
import {AppError} from '@ulpin/server/infrastructure/errors';
import {readBoundedBytes} from '../../common/body';
import {jsonBody,wireResponse} from '../intake/wire-schemas';
import {PrivateSpatialGuard} from '../spatial/private-spatial.guard';
const param=(name:string)=>ApiParam({name,schema:{type:'string',format:'uuid'}});
@UseGuards(PrivateSpatialGuard)
@Controller('api/v1/ingestion/cases/:caseId/document-claims/reviews')
export class DocumentClaimsController{
  constructor(@Inject(DocumentClaimsService) private readonly service:DocumentClaimsService){}
  @Post() @HttpCode(201) @Header('Cache-Control','private, no-store') @param('caseId')
  @ApiOperation({operationId:'POST_api_v1_ingestion_cases_caseId_document_claims_reviews',
    summary:'Save an immutable manually reviewed PDF source-claim snapshot with unresolved property applicability'})
  @jsonBody(DocumentClaimsReviewRequestSchema) @wireResponse(201,DocumentClaimReviewSchema,[408,429,504])
  async review(@Param('caseId') caseId:string,@Req() request:Request){
    const bytes=await readBoundedBytes(request,DOCUMENT_CLAIMS_LIMITS.requestBytes,30000);
    let value:unknown;try{value=JSON.parse(bytes.toString('utf8'));}
    catch{throw new AppError(400,'INVALID_JSON','The source review body must be valid JSON.');}
    return this.service.review(caseId,DocumentClaimsReviewRequestSchema.parse(value));
  }
  @Get(':reviewId') @Header('Cache-Control','private, no-store') @param('caseId') @param('reviewId')
  @ApiQuery({name:'revision',required:true,schema:{type:'integer',minimum:1}})
  @ApiOperation({operationId:'GET_api_v1_ingestion_cases_caseId_document_claims_reviews_reviewId',
    summary:'Read one exact source-review revision through current private original and access authority'})
  @wireResponse(200,DocumentClaimReviewSchema,[504])
  read(@Param('caseId') caseId:string,@Param('reviewId') reviewId:string,@Req() request:Request){
    const parameters=new URL(request.originalUrl??request.url,'http://localhost').searchParams;
    for(const key of parameters.keys())if(parameters.getAll(key).length!==1)
      throw new AppError(422,'DOCUMENT_CLAIMS_QUERY','Use one exact value for each source-review query field.');
    return this.service.read(caseId,reviewId,Object.fromEntries(parameters));
  }
}
