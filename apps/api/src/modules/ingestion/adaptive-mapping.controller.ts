import {Controller,HttpCode,Inject,Param,Post,Req,UseGuards} from '@nestjs/common';
import {ApiOperation,ApiParam,ApiTags} from '@nestjs/swagger';
import type {Request} from 'express';
import {AdaptiveMappingRequestSchema,AdaptiveMappingResponseSchema} from '@ulpin/contracts/usp';
import {AdaptiveMappingService} from '@ulpin/server/modules/usp/ingestion/adaptive-mapping-service';
import {JSON_BODY_LIMIT,readJsonBody} from '../../common/body';
import {jsonBody,wireResponse} from '../intake/wire-schemas';
import {PrivateSpatialGuard} from '../spatial/private-spatial.guard';

const param=(name:string)=>ApiParam({name,schema:{type:'string',format:'uuid'}});

@ApiTags('manual ingestion')
@UseGuards(PrivateSpatialGuard)
@Controller('api/v1/ingestion')
export class AdaptiveMappingController{
  constructor(@Inject(AdaptiveMappingService) private readonly mapping:AdaptiveMappingService){}

  @Post('cases/:caseId/sources/:sourceId/mapping-proposals')
  @HttpCode(200) @param('caseId') @param('sourceId')
  @ApiOperation({operationId:'POST_api_v1_ingestion_cases_caseId_sources_sourceId_mapping_proposals',
    summary:'Request one source-pinned GIS mapping proposal; authoring and approval remain separate manual recipe operations'})
  @jsonBody(AdaptiveMappingRequestSchema) @wireResponse(200,AdaptiveMappingResponseSchema)
  async propose(@Param('caseId') caseId:string,@Param('sourceId') sourceId:string,@Req() request:Request){
    return this.mapping.propose(caseId,sourceId,await readJsonBody(request,JSON_BODY_LIMIT));
  }
}
