import {Controller,Get,HttpCode,Inject,Param,Post,Req,UseGuards} from '@nestjs/common';
import {ApiOperation,ApiParam,ApiTags} from '@nestjs/swagger';
import type {Request} from 'express';
import {z} from 'zod';
import {CHUNK_MAPPING_LIMITS,ChunkMappingRequestSchema,ChunkMappingStatusSchema,ChunkMappingChunkResponseSchema} from '@ulpin/contracts/usp';
import {ChunkMappingService} from '@ulpin/server/modules/usp/ingestion/chunk-mapping';
import {AppError} from '@ulpin/server/infrastructure/errors';
import {JSON_BODY_LIMIT,readJsonBody} from '../../common/body';
import {jsonBody,wireResponse} from '../intake/wire-schemas';
import {PrivateSpatialGuard} from '../spatial/private-spatial.guard';

const param=(name:string)=>ApiParam({name,schema:{type:'string',format:'uuid'}});
function noQuery(request:Request){if(new URL(request.originalUrl,'http://localhost').searchParams.size)
  throw new AppError(422,'MAPPING_QUERY','Private mapped drafts have no query fields.');}

@ApiTags('private mapped vector drafts')
@UseGuards(PrivateSpatialGuard)
@Controller('api/v1/ingestion/cases/:caseId/sources/:sourceId/chunk-mapping')
export class ChunkMappingController{
  constructor(@Inject(ChunkMappingService)private readonly mapping:ChunkMappingService){}
  @Post() @HttpCode(202) @param('caseId') @param('sourceId')
  @ApiOperation({operationId:'POST_api_v1_ingestion_cases_caseId_sources_sourceId_chunk_mapping',
    summary:'Queue a bounded mapping projection over published raw source chunks'})
  @jsonBody(ChunkMappingRequestSchema) @wireResponse(202,ChunkMappingStatusSchema,[429])
  async enqueue(@Param('caseId')caseId:string,@Param('sourceId')sourceId:string,@Req()request:Request){
    noQuery(request);return this.mapping.enqueue(caseId,sourceId,await readJsonBody(request,JSON_BODY_LIMIT));
  }
  @Get('jobs/:jobId') @param('caseId') @param('sourceId') @param('jobId')
  @ApiOperation({operationId:'GET_api_v1_ingestion_cases_caseId_sources_sourceId_chunk_mapping_jobs_jobId',
    summary:'Read retained mapped coverage and recipe pins with explicit current/history reasons'})
  @wireResponse(200,ChunkMappingStatusSchema)
  status(@Param('caseId')caseId:string,@Param('sourceId')sourceId:string,@Param('jobId')jobId:string,@Req()request:Request){
    noQuery(request);return this.mapping.status(caseId,sourceId,jobId);
  }
  @Get('jobs/:jobId/chunks/:chunkIndex') @param('caseId') @param('sourceId') @param('jobId')
  @ApiParam({name:'chunkIndex',schema:{type:'integer',minimum:0,maximum:CHUNK_MAPPING_LIMITS.chunks}})
  @ApiOperation({operationId:'GET_api_v1_ingestion_cases_caseId_sources_sourceId_chunk_mapping_jobs_jobId_chunks_chunkIndex',
    summary:'Read one integrity-verified private mapped chunk, including obsolete pinned results'})
  @wireResponse(200,ChunkMappingChunkResponseSchema)
  chunk(@Param('caseId')caseId:string,@Param('sourceId')sourceId:string,@Param('jobId')jobId:string,
    @Param('chunkIndex')chunkIndex:string,@Req()request:Request){
    noQuery(request);const index=z.string().regex(/^(0|[1-9]\d*)$/).transform(Number)
      .pipe(z.number().int().min(0).max(CHUNK_MAPPING_LIMITS.chunks)).parse(chunkIndex);
    return this.mapping.chunk(caseId,sourceId,jobId,index);
  }
}
