import {Controller,Get,HttpCode,Inject,Param,Post,Req,UseGuards} from '@nestjs/common';
import {ApiOperation,ApiParam,ApiTags} from '@nestjs/swagger';
import type {Request} from 'express';
import {z} from 'zod';
import {AnyStreamingRequestSchema,AnyStreamingStatusSchema,
  StreamingVectorChunkResponseSchema} from '@ulpin/contracts/usp';
import {StreamingVectorService} from '@ulpin/server/modules/usp/ingestion/streaming-vector';
import {AppError} from '@ulpin/server/infrastructure/errors';
import {JSON_BODY_LIMIT,readJsonBody} from '../../common/body';
import {jsonBody,wireResponse} from '../intake/wire-schemas';
import {PrivateSpatialGuard} from '../spatial/private-spatial.guard';

const param=(name:string)=>ApiParam({name,schema:{type:'string',format:'uuid'}});
function noQuery(request:Request){if(new URL(request.originalUrl,'http://localhost').searchParams.size)
  throw new AppError(422,'STREAMING_QUERY','This private draft read has no query fields.');}

@ApiTags('private streaming vector drafts')
@UseGuards(PrivateSpatialGuard)
@Controller('api/v1/ingestion/cases/:caseId/sources/:sourceId/streaming-vector')
export class StreamingVectorController{
  constructor(@Inject(StreamingVectorService)private readonly streaming:StreamingVectorService){}
  @Post() @HttpCode(202) @param('caseId') @param('sourceId')
  @ApiOperation({operationId:'POST_api_v1_ingestion_cases_caseId_sources_sourceId_streaming_vector',
    summary:'Queue retained GeoJSON or pinned D8 tabular bytes for bounded source-native draft chunks'})
  @jsonBody(AnyStreamingRequestSchema) @wireResponse(202,AnyStreamingStatusSchema,[429])
  async enqueue(@Param('caseId')caseId:string,@Param('sourceId')sourceId:string,@Req()request:Request){
    noQuery(request);return this.streaming.enqueue(caseId,sourceId,await readJsonBody(request,JSON_BODY_LIMIT));
  }
  @Get('jobs/:jobId') @param('caseId') @param('sourceId') @param('jobId')
  @ApiOperation({operationId:'GET_api_v1_ingestion_cases_caseId_sources_sourceId_streaming_vector_jobs_jobId',
    summary:'Read current ordered draft watermark, coverage and incomplete-source state'})
  @wireResponse(200,AnyStreamingStatusSchema)
  status(@Param('caseId')caseId:string,@Param('sourceId')sourceId:string,@Param('jobId')jobId:string,@Req()request:Request){
    noQuery(request);return this.streaming.status(caseId,sourceId,jobId);
  }
  @Get('jobs/:jobId/chunks/:chunkIndex') @param('caseId') @param('sourceId') @param('jobId')
  @ApiParam({name:'chunkIndex',schema:{type:'integer',minimum:0,maximum:4096}})
  @ApiOperation({operationId:'GET_api_v1_ingestion_cases_caseId_sources_sourceId_streaming_vector_jobs_jobId_chunks_chunkIndex',
    summary:'Read one published private source-native chunk or terminal quarantine marker'})
  @wireResponse(200,StreamingVectorChunkResponseSchema)
  chunk(@Param('caseId')caseId:string,@Param('sourceId')sourceId:string,@Param('jobId')jobId:string,
    @Param('chunkIndex')chunkIndex:string,@Req()request:Request){
    noQuery(request);const index=z.string().regex(/^(0|[1-9]\d*)$/).transform(Number).pipe(z.number().int().min(0).max(4096)).parse(chunkIndex);
    return this.streaming.chunk(caseId,sourceId,jobId,index);
  }
}
