import {Controller,HttpCode,Inject,Post,Req,Res,UseFilters,UseGuards} from '@nestjs/common';
import {ApiBody,ApiOperation,ApiResponse,ApiTags} from '@nestjs/swagger';
import type {Request,Response} from 'express';
import {SourceFusionRequestSchema,SourceFusionContextSchema,SOURCE_FUSION_LIMITS} from '../../../../../packages/contracts/src/source-fusion';
import {SourceFusionService} from '@ulpin/server/modules/usp/ingestion/source-fusion';
import {localRequestContext} from '@ulpin/server/modules/usp/principal';
import {AppError} from '@ulpin/server/infrastructure/errors';
import {readBoundedBytes} from '../../common/body';
import {requestId} from '../../common/request-context';
import {PrivateSpatialGuard} from '../spatial/private-spatial.guard';
import {EvidenceExceptionFilter,uspEnvelope} from './evidence.http';
import {envelopeSchema,requestApiSchema,evidenceSchemas,openApiSchema} from './evidence.schemas';

const errorSchema=openApiSchema(evidenceSchemas.error);

@ApiTags('USP combined source context')
@UseFilters(EvidenceExceptionFilter)
@UseGuards(PrivateSpatialGuard)
@Controller('api/v1/usp/evidence/source-fusion')
export class SourceFusionController{
  constructor(@Inject(SourceFusionService) private readonly service:SourceFusionService){}
  @Post('context')
  @HttpCode(200)
  @ApiOperation({operationId:'POST_api_v1_usp_evidence_source_fusion_context',
    summary:'Assemble private explicitly selected accepted native document/OCR/CityJSON/IFC/DXF/KML/CityGML/GeoParquet/raster-metadata/point-metadata/survey-report/glTF-node fragments without establishing an association'})
  @ApiBody({required:true,description:'JSON; maximum 64 KiB of received bytes; 2–8 exact sources and 25 selections total',
    schema:requestApiSchema(SourceFusionRequestSchema)})
  @ApiResponse({status:200,description:'Private bounded context; association remains not_assessed',schema:envelopeSchema(SourceFusionContextSchema),
    headers:{'Cache-Control':{schema:{type:'string',enum:['private, no-store']}}}})
  @ApiResponse({status:400,description:'Invalid strict source selection',schema:errorSchema})
  @ApiResponse({status:403,description:'Common private Host/Origin or current-access denial',schema:openApiSchema(evidenceSchemas.forbiddenError)})
  @ApiResponse({status:404,description:'Requested accepted context unavailable; no partial source details',schema:errorSchema})
  @ApiResponse({status:408,description:'Bounded request body deadline expired',schema:errorSchema})
  @ApiResponse({status:409,description:'Accepted source/job/reader/attempt pins changed',schema:errorSchema})
  @ApiResponse({status:413,description:'Request, artifact or response exceeds the profile',schema:errorSchema})
  @ApiResponse({status:422,description:'Exact selected evidence or integrity unavailable',schema:errorSchema})
  @ApiResponse({status:503,description:'Bounded service unavailable or deadline expired',schema:errorSchema})
  async context(@Req() request:Request,@Res({passthrough:true}) response:Response){
    response.setHeader('Cache-Control','private, no-store');
    const bytes=await readBoundedBytes(request,SOURCE_FUSION_LIMITS.requestBytes,5000);
    let raw:unknown;
    try{raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
    catch{throw new AppError(400,'SOURCE_FUSION_JSON','A strict JSON source selection is required.');}
    const input=SourceFusionRequestSchema.parse(raw);
    const data=await this.service.assemble(localRequestContext(requestId(request)),input);
    const first=data.sources[0].pin;
    // Envelope intake scope anchors one selected evidence workspace. Every
    // source has its own case/revision pin; this is not a shared property scope.
    return uspEnvelope(request,{kind:'intake',workspaceId:first.caseId,version:first.caseRevision+1},data);
  }
}
