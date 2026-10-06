import {Controller,Get,Header,HttpCode,Inject,Param,Post,Req,UseGuards} from '@nestjs/common';
import {ApiOperation,ApiParam,ApiQuery,ApiTags} from '@nestjs/swagger';
import type {Request} from 'express';
import {DOCUMENT_PROPOSAL_LIMITS,DocumentProposalsSaveSchema,DocumentProposalSnapshotViewSchema,
  DocumentProposalsHistoryQuerySchema,DocumentProposalsHistorySchema,DocumentProposalDecisionSaveSchema,
  DocumentProposalDecisionViewSchema,DocumentProposalDecisionReadQuerySchema,
  DocumentProposalDecisionHistoryQuerySchema,DocumentProposalDecisionHistorySchema}
  from '../../../../../packages/contracts/src/usp/document-proposals';
import {DocumentProposalsService} from '@ulpin/server/modules/usp/ingestion/document-proposals';
import {AppError} from '@ulpin/server/infrastructure/errors';
import {readBoundedBytes} from '../../common/body';
import {jsonBody,wireResponse} from '../intake/wire-schemas';
import {PrivateSpatialGuard} from '../spatial/private-spatial.guard';
const param=(name:string)=>ApiParam({name,schema:{type:'string',format:'uuid'}});
function noQuery(request:Request){if(new URL(request.originalUrl??request.url,'http://localhost').search)
  throw new AppError(422,'DOCUMENT_PROPOSALS_QUERY','The exact proposal route accepts no query fields.');}
function historyQuery(request:Request){
  const fields:Record<string,string>=Object.create(null);
  for(const [key,value] of new URL(request.originalUrl??request.url,'http://localhost').searchParams){
    if(!['after','limit'].includes(key)||Object.hasOwn(fields,key))
      throw new AppError(422,'DOCUMENT_PROPOSALS_QUERY','Use only one after cursor and one limit on the history route.');
    fields[key]=value;
  }
  DocumentProposalsHistoryQuerySchema.parse(fields);return fields;
}
function decisionQuery(request:Request,keys:string[]){
  const fields:Record<string,string>=Object.create(null);
  for(const [key,value] of new URL(request.originalUrl??request.url,'http://localhost').searchParams){
    if(!keys.includes(key)||Object.hasOwn(fields,key))
      throw new AppError(422,'DOCUMENT_PROPOSALS_QUERY','Use each supported decision query field exactly once.');
    fields[key]=value;
  }
  return fields;
}
@ApiTags('document proposals')
@UseGuards(PrivateSpatialGuard)
@Controller('api/v1/ingestion/cases/:caseId/sources/:sourceId/document-proposals')
export class DocumentProposalsController{
  constructor(@Inject(DocumentProposalsService) private readonly service:DocumentProposalsService){}
  @Get() @Header('Cache-Control','private, no-store') @param('caseId') @param('sourceId')
  @ApiQuery({name:'after',required:false,schema:{type:'string',format:'uuid'}})
  @ApiQuery({name:'limit',required:false,schema:{type:'integer',minimum:1,maximum:10,default:5}})
  @ApiOperation({operationId:'GET_api_v1_ingestion_cases_caseId_sources_sourceId_document_proposals',
    summary:'Discover a bounded UUID-ordered page of private saved proposal references',
    description:'Follow readUrl for exact content. A stale/corrupt snapshot refuses the page; refresh without after to discover new saves.'})
  @wireResponse(200,DocumentProposalsHistorySchema,[504])
  history(@Param('caseId') caseId:string,@Param('sourceId') sourceId:string,@Req() request:Request){
    return this.service.history(caseId,sourceId,historyQuery(request));
  }
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
  @Post(':snapshotId/decisions') @HttpCode(201) @Header('Cache-Control','private, no-store')
  @param('caseId') @param('sourceId') @param('snapshotId')
  @ApiOperation({operationId:'POST_api_v1_ingestion_cases_caseId_sources_sourceId_document_proposals_snapshotId_decisions',
    summary:'Record an explicit decision on an exact saved provisional proposal',
    description:'Current source-cited transcription remains unverified. Corrections append immutable history; original proposals/conflicts remain unchanged. No canonical adoption or learning label.'})
  @jsonBody(DocumentProposalDecisionSaveSchema) @wireResponse(201,DocumentProposalDecisionViewSchema,[408,504])
  async reviewDecision(@Param('caseId') caseId:string,@Param('sourceId') sourceId:string,@Param('snapshotId') snapshotId:string,@Req() request:Request){
    noQuery(request);const bytes=await readBoundedBytes(request,DOCUMENT_PROPOSAL_LIMITS.requestBytes,30000);
    let raw:unknown;try{raw=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes));}
    catch{throw new AppError(400,'INVALID_JSON','The decision must be valid UTF-8 JSON.');}
    return this.service.reviewDecision(caseId,sourceId,snapshotId,DocumentProposalDecisionSaveSchema.parse(raw));
  }
  @Get(':snapshotId/decisions') @Header('Cache-Control','private, no-store') @param('caseId') @param('sourceId') @param('snapshotId')
  @ApiQuery({name:'after',required:false,schema:{type:'string',description:'Exact decisionId:decisionRevision cursor'}})
  @ApiQuery({name:'limit',required:false,schema:{type:'integer',minimum:1,maximum:10,default:5}})
  @ApiOperation({operationId:'GET_api_v1_ingestion_cases_caseId_sources_sourceId_document_proposals_snapshotId_decisions',
    summary:'Discover bounded exact decision revisions for one unchanged proposal snapshot'})
  @wireResponse(200,DocumentProposalDecisionHistorySchema,[504])
  decisionHistory(@Param('caseId') caseId:string,@Param('sourceId') sourceId:string,@Param('snapshotId') snapshotId:string,@Req() request:Request){
    const query=decisionQuery(request,['after','limit']);DocumentProposalDecisionHistoryQuerySchema.parse(query);
    return this.service.decisionHistory(caseId,sourceId,snapshotId,query);
  }
  @Get(':snapshotId/decisions/:decisionId') @Header('Cache-Control','private, no-store')
  @param('caseId') @param('sourceId') @param('snapshotId') @param('decisionId')
  @ApiQuery({name:'revision',required:true,schema:{type:'integer',minimum:1}})
  @ApiOperation({operationId:'GET_api_v1_ingestion_cases_caseId_sources_sourceId_document_proposals_snapshotId_decisions_decisionId',
    summary:'Read an exact immutable proposal decision through current original and private access authority'})
  @wireResponse(200,DocumentProposalDecisionViewSchema,[504])
  readDecision(@Param('caseId') caseId:string,@Param('sourceId') sourceId:string,@Param('snapshotId') snapshotId:string,
    @Param('decisionId') decisionId:string,@Req() request:Request){
    const query=decisionQuery(request,['revision']);DocumentProposalDecisionReadQuerySchema.parse(query);
    return this.service.readDecision(caseId,sourceId,snapshotId,decisionId,query);
  }
  @Get(':snapshotId') @Header('Cache-Control','private, no-store') @param('caseId') @param('sourceId') @param('snapshotId')
  @ApiOperation({operationId:'GET_api_v1_ingestion_cases_caseId_sources_sourceId_document_proposals_snapshotId',
    summary:'Read one exact immutable provisional proposal snapshot through current private original authority'})
  @wireResponse(200,DocumentProposalSnapshotViewSchema,[504])
  read(@Param('caseId') caseId:string,@Param('sourceId') sourceId:string,@Param('snapshotId') snapshotId:string,@Req() request:Request){
    noQuery(request);return this.service.read(caseId,sourceId,snapshotId);
  }
}
