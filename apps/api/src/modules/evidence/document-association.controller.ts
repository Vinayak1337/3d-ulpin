import {Controller,HttpCode,Inject,Post,Req,UseFilters,UseGuards} from '@nestjs/common';
import {ApiTags} from '@nestjs/swagger';
import type {Request} from 'express';
import {DocumentAssociationPreviewRequestSchema,DocumentAssociationPreviewSchema} from '@ulpin/contracts';
import {DocumentAssociationService} from '@ulpin/server/modules/usp/ingestion/document-association';
import {localRequestContext} from '@ulpin/server/modules/usp/principal';
import {requestId} from '../../common/request-context';
import {PrivateSpatialGuard} from '../spatial/private-spatial.guard';
import {EvidenceExceptionFilter,readUspBody,UspJsonPost,uspEnvelope} from './evidence.http';

@ApiTags('USP document association review')
@UseFilters(EvidenceExceptionFilter)
@UseGuards(PrivateSpatialGuard)
@Controller('api/v1/usp/evidence/document-association')
export class DocumentAssociationController{
  constructor(@Inject(DocumentAssociationService) private readonly service:DocumentAssociationService){}
  @Post('preview')
  @HttpCode(200)
  @UspJsonPost('POST_api_v1_usp_evidence_document_association_preview',
    'Prepare private exact native citations and current building/floor context without accepting an association',
    DocumentAssociationPreviewRequestSchema,DocumentAssociationPreviewSchema)
  async preview(@Req() request:Request){
    const input=await readUspBody(request,DocumentAssociationPreviewRequestSchema);
    const data=await this.service.preview(localRequestContext(requestId(request)),input);
    return uspEnvelope(request,input.scope??{kind:'intake',workspaceId:input.document.caseId,version:input.document.caseRevision+1},data);
  }
}
