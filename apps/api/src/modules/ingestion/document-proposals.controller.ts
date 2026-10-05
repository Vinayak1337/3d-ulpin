import {Controller,Get,Header,HttpCode,Inject,Param,Post,Req,UseGuards} from '@nestjs/common';
import {ApiOperation,ApiParam,ApiTags} from '@nestjs/swagger';
import type {Request} from 'express';
import {DOCUMENT_PROPOSAL_LIMITS,DocumentProposalsSaveSchema,DocumentProposalSnapshotViewSchema}
  from '../../../../../packages/contracts/src/usp/document-proposals';
import {DocumentProposalsService} from '@ulpin/server/modules/usp/ingestion/document-proposals';
import {AppError} from '@ulpin/server/infrastructure/errors';
import {readBoundedBytes} from '../../common/body';
import {jsonBody,wireResponse} from '../intake/wire-schemas';
import {PrivateSpatialGuard} from '../spatial/private-spatial.guard';
const param=(name:string)=>ApiParam({name,schema:{type:'string',format:'uuid'}});
function noQuery(request:Request){if(new URL(request.originalUrl??request.url,'http://localhost').search)
  throw new AppError(422,'DOCUMENT_PROPOSALS_QUERY','The exact proposal route accepts no query fields.');}
@ApiTags('document proposals')
@UseGuards(PrivateSpatialGuard)
@Controller('api/v1/ingestion/cases/:caseId/sources/:sourceId/document-proposals')
export class DocumentProposalsController{
  constructor(@Inject(DocumentProposalsService) private readonly service:DocumentProposalsService){}
  @Post() @HttpCode(201) @Header('Cache-Control','private, no-store') @param('caseId') @param('sourceId')
  @ApiOperation({operationId:'POST_api_v1_ingestion_cases_caseId_sources_sourceId_document_proposals',
    summary:'Save a source-scoped caller-supplied provisional document proposal packet',
    description:'Declared methods/hashes are unverified caller content, not observed model execution or human_entry. Saving is not adoption.'})
  @jsonBody(DocumentProposalsSaveSchema) @wireResponse(201,DocumentProposalSnapshotViewSchema,[408,504])
  async save(@Param('caseId') caseId:string,@Param('sourceId') sourceId:string,@Req() request:Request){
    noQuery(request);const bytes=await readBoundedBytes(request,DOCUMENT_PROPOSAL_LIMITS.requestBytes,30000);
    let raw:unknown;try{raw=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes));}
    catch{throw new AppError(400,'INVALID_JSON','The proposal packet must be valid UTF-8 JSON.');}
    return this.service.save(caseId,sourceId,DocumentProposalsSaveSchema.parse(raw));
  }
  @Get(':snapshotId') @Header('Cache-Control','private, no-store') @param('caseId') @param('sourceId') @param('snapshotId')
  @ApiOperation({operationId:'GET_api_v1_ingestion_cases_caseId_sources_sourceId_document_proposals_snapshotId',
    summary:'Read one exact immutable provisional proposal snapshot through current private original authority'})
  @wireResponse(200,DocumentProposalSnapshotViewSchema,[504])
  read(@Param('caseId') caseId:string,@Param('sourceId') sourceId:string,@Param('snapshotId') snapshotId:string,@Req() request:Request){
    noQuery(request);return this.service.read(caseId,sourceId,snapshotId);
  }
}
