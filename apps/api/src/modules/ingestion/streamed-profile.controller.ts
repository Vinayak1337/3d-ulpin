import {Controller,Get,HttpCode,Inject,Param,Post,Req,UseGuards} from '@nestjs/common';
import {ApiOperation,ApiParam,ApiTags} from '@nestjs/swagger';
import type {Request} from 'express';
import {z} from 'zod';
import {STREAMED_PROFILE_LIMITS,StreamedProfileRequestSchema,StreamedProfileStatusSchema,
  StreamedProfileGenerationSchema,StreamedMappingAuthorSchema,StreamedMappingReceiptSchema,
  MappingDecisionSchema} from '@ulpin/contracts/usp';
import {StreamedProfileService} from '@ulpin/server/modules/usp/ingestion/streamed-profile';
import {StreamedMappingService} from '@ulpin/server/modules/usp/ingestion/streamed-mapping';
import {AppError} from '@ulpin/server/infrastructure/errors';
import {JSON_BODY_LIMIT,readJsonBody} from '../../common/body';
import {jsonBody,wireResponse} from '../intake/wire-schemas';
import {PrivateSpatialGuard} from '../spatial/private-spatial.guard';

const param=(name:string)=>ApiParam({name,schema:{type:'string',format:'uuid'}});
function noQuery(request:Request){if(new URL(request.originalUrl,'http://localhost').searchParams.size)
  throw new AppError(422,'STREAMED_PROFILE_QUERY','Private profiles have no query fields.');}

@ApiTags('private streamed source profiles')
@UseGuards(PrivateSpatialGuard)
@Controller('api/v1/ingestion/cases/:caseId/sources/:sourceId/streamed-profile')
export class StreamedProfileController{
  constructor(@Inject(StreamedProfileService)private readonly profile:StreamedProfileService,
    @Inject(StreamedMappingService)private readonly mapping:StreamedMappingService){}
  @Post() @HttpCode(202) @param('caseId') @param('sourceId')
  @ApiOperation({operationId:'POST_api_v1_ingestion_cases_caseId_sources_sourceId_streamed_profile',
    summary:'Queue bounded field inventory over published raw source chunks'})
  @jsonBody(StreamedProfileRequestSchema) @wireResponse(202,StreamedProfileStatusSchema,[429])
  async enqueue(@Param('caseId')caseId:string,@Param('sourceId')sourceId:string,@Req()request:Request){
    noQuery(request);return this.profile.enqueue(caseId,sourceId,await readJsonBody(request,JSON_BODY_LIMIT));
  }
  @Get('jobs/:jobId') @param('caseId') @param('sourceId') @param('jobId')
  @ApiOperation({operationId:'GET_api_v1_ingestion_cases_caseId_sources_sourceId_streamed_profile_jobs_jobId',
    summary:'Read provisional or sealed source field coverage'})
  @wireResponse(200,StreamedProfileStatusSchema)
  status(@Param('caseId')caseId:string,@Param('sourceId')sourceId:string,@Param('jobId')jobId:string,@Req()request:Request){
    noQuery(request);return this.profile.status(caseId,sourceId,jobId);
  }
  @Get('jobs/:jobId/generations/:generation') @param('caseId') @param('sourceId') @param('jobId')
  @ApiParam({name:'generation',schema:{type:'integer',minimum:0,maximum:STREAMED_PROFILE_LIMITS.generations}})
  @ApiOperation({operationId:'GET_api_v1_ingestion_cases_caseId_sources_sourceId_streamed_profile_jobs_jobId_generations_generation',
    summary:'Read one immutable source-pinned field inventory generation'})
  @wireResponse(200,StreamedProfileGenerationSchema)
  generation(@Param('caseId')caseId:string,@Param('sourceId')sourceId:string,@Param('jobId')jobId:string,
    @Param('generation')generation:string,@Req()request:Request){
    noQuery(request);const index=z.string().regex(/^(0|[1-9]\d*)$/).transform(Number)
      .pipe(z.number().int().nonnegative().max(STREAMED_PROFILE_LIMITS.generations)).parse(generation);
    return this.profile.generation(caseId,sourceId,jobId,index);
  }
  @Post('jobs/:jobId/recipes') @HttpCode(201) @param('caseId') @param('sourceId') @param('jobId')
  @ApiOperation({operationId:'POST_api_v1_ingestion_cases_caseId_sources_sourceId_streamed_profile_jobs_jobId_recipes',
    summary:'Author a reviewed exact-source recipe against a sealed field inventory'})
  @jsonBody(StreamedMappingAuthorSchema) @wireResponse(201,StreamedMappingReceiptSchema)
  async author(@Param('caseId')caseId:string,@Param('sourceId')sourceId:string,@Param('jobId')jobId:string,
    @Req()request:Request){noQuery(request);return this.mapping.author(caseId,sourceId,jobId,
      await readJsonBody(request,JSON_BODY_LIMIT));}
  @Post('jobs/:jobId/recipes/:recipeId/approve') @HttpCode(200)
  @param('caseId') @param('sourceId') @param('jobId') @param('recipeId')
  @ApiOperation({operationId:'POST_api_v1_ingestion_cases_caseId_sources_sourceId_streamed_profile_jobs_jobId_recipes_recipeId_approve',
    summary:'Approve a sealed profile recipe in the configured local operator context'})
  @jsonBody(MappingDecisionSchema) @wireResponse(200,StreamedMappingReceiptSchema)
  async approve(@Param('caseId')caseId:string,@Param('sourceId')sourceId:string,@Param('jobId')jobId:string,
    @Param('recipeId')recipeId:string,@Req()request:Request){noQuery(request);
    return this.mapping.approve(caseId,sourceId,jobId,recipeId,await readJsonBody(request,JSON_BODY_LIMIT));}
  @Get('jobs/:jobId/recipes/:recipeId')
  @param('caseId') @param('sourceId') @param('jobId') @param('recipeId')
  @ApiOperation({operationId:'GET_api_v1_ingestion_cases_caseId_sources_sourceId_streamed_profile_jobs_jobId_recipes_recipeId',
    summary:'Read a current exact-source streamed recipe and approval'})
  @wireResponse(200,StreamedMappingReceiptSchema)
  read(@Param('caseId')caseId:string,@Param('sourceId')sourceId:string,@Param('jobId')jobId:string,
    @Param('recipeId')recipeId:string,@Req()request:Request){noQuery(request);
    return this.mapping.read(caseId,sourceId,jobId,recipeId);}
}
