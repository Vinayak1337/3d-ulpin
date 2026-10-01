import {Controller,HttpCode,Inject,Post,Req,Res,UseFilters,UseGuards} from '@nestjs/common';
import {ApiBody,ApiOperation,ApiResponse,ApiTags} from '@nestjs/swagger';
import type {Request,Response} from 'express';
import {FusionAssociationRequestSchema,FusionAssociationResponseSchema,FUSION_ASSOCIATION_LIMITS}
  from '../../../../../packages/contracts/src/source-fusion-associations';
import {SourceFusionAssociationService} from '@ulpin/server/modules/usp/ingestion/source-fusion-associations';
import {localRequestContext} from '@ulpin/server/modules/usp/principal';
import {AppError} from '@ulpin/server/infrastructure/errors';
import {readBoundedBytes} from '../../common/body';
import {requestId} from '../../common/request-context';
import {PrivateSpatialGuard} from '../spatial/private-spatial.guard';
import {EvidenceExceptionFilter,uspEnvelope} from './evidence.http';
import {envelopeSchema,requestApiSchema,evidenceSchemas,openApiSchema} from './evidence.schemas';

const errorSchema=openApiSchema(evidenceSchemas.error);
@ApiTags('USP source association proposals')
@UseFilters(EvidenceExceptionFilter)
@UseGuards(PrivateSpatialGuard)
@Controller('api/v1/usp/evidence/source-fusion')
export class SourceFusionAssociationsController{
  constructor(@Inject(SourceFusionAssociationService) private readonly service:SourceFusionAssociationService){}
  @Post('association-proposals')
  @HttpCode(200)
  @ApiOperation({operationId:'POST_api_v1_usp_evidence_source_fusion_association_proposals',
    summary:'Propose private exact-identifier building/floor associations for explicit review; no automatic recording'})
  @ApiBody({required:true,description:'Strict JSON, maximum 64 KiB; 2–8 accepted sources, 25 fragments and at most 8 exact recorded targets',
    schema:requestApiSchema(FusionAssociationRequestSchema)})
  @ApiResponse({status:200,description:'Proposals or explicit abstentions; manual selection remains available',
    schema:envelopeSchema(FusionAssociationResponseSchema),headers:{'Cache-Control':{schema:{type:'string',enum:['private, no-store']}}}})
  @ApiResponse({status:400,description:'Invalid strict source/target selection',schema:errorSchema})
  @ApiResponse({status:403,description:'Private Host/Origin, site, source, target, access or model-policy denial',schema:openApiSchema(evidenceSchemas.forbiddenError)})
  @ApiResponse({status:404,description:'Exact selected context unavailable',schema:errorSchema})
  @ApiResponse({status:408,description:'Received-body deadline expired',schema:errorSchema})
  @ApiResponse({status:409,description:'Source, target, snapshot or accepted-result pins changed',schema:errorSchema})
  @ApiResponse({status:413,description:'Request or response exceeds the bounded profile',schema:errorSchema})
  @ApiResponse({status:422,description:'Exact selected evidence or integrity unavailable',schema:errorSchema})
  @ApiResponse({status:503,description:'Proposal request deadline expired or authority unavailable',schema:errorSchema})
  async propose(@Req() request:Request,@Res({passthrough:true}) response:Response){
    response.setHeader('Cache-Control','private, no-store');
    const bytes=await readBoundedBytes(request,FUSION_ASSOCIATION_LIMITS.requestBytes,5000);
    let raw:unknown;
    try{raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
    catch{throw new AppError(400,'FUSION_ASSOCIATION_JSON','A strict JSON evidence and target selection is required.');}
    const input=FusionAssociationRequestSchema.parse(raw);
    const data=await this.service.propose(localRequestContext(requestId(request)),input);
    const first=data.context.sources[0].pin;
    return uspEnvelope(request,input.scope??{kind:'intake',workspaceId:first.caseId,version:first.caseRevision+1},data);
  }
}
