import {Controller,Get,HttpCode,Inject,Param,Post,Req,Res,UseGuards} from '@nestjs/common';
import {ApiOperation,ApiParam,ApiQuery,ApiResponse,ApiTags} from '@nestjs/swagger';
import type {Request,Response} from 'express';
import {z} from 'zod';
import {ProjectedVectorRequestSchema,ProjectedVectorStatusSchema,AdministrativeObservationPageSchema,SemanticChunkResponseSchema} from '@ulpin/contracts/usp';
import {ProjectedVectorService} from '@ulpin/server/modules/usp/ingestion/projected-vector';
import {SemanticChunkService} from '@ulpin/server/modules/usp/ingestion/semantic-chunks';
import {AppError} from '@ulpin/server/infrastructure/errors';
import {JSON_BODY_LIMIT,readJsonBody} from '../../common/body';
import {jsonBody,wireResponse,binary} from '../intake/wire-schemas';
import {PrivateSpatialGuard} from '../spatial/private-spatial.guard';

const param=(name:string)=>ApiParam({name,schema:{type:'string',format:'uuid'}});
function queryValues(request:Request,allowed:string[]){
  const query=new URL(request.originalUrl,'http://localhost').searchParams;
  for(const key of query.keys())if(!allowed.includes(key)||query.getAll(key).length!==1)throw new AppError(422,'PROJECTED_QUERY','Use one value for each declared query field.');
  return Object.fromEntries(query.entries());
}
function chunkPin(q:Record<string,string>){
  if(q.chunkSequence===undefined&&q.chunkSha256===undefined)return undefined;
  if(q.chunkSequence===undefined||q.chunkSha256===undefined)throw new AppError(422,'SEMANTIC_PREFIX_PIN','Use both chunkSequence and chunkSha256.');
  return {sequence:decimal.parse(q.chunkSequence),sha256:q.chunkSha256};
}
const decimal=z.string().regex(/^(0|[1-9]\d*)$/).transform(Number);

@ApiTags('projected administrative context')
@UseGuards(PrivateSpatialGuard)
@Controller('api/v1/ingestion/cases/:caseId/sources/:sourceId/projected-vector')
export class ProjectedVectorController{
  constructor(@Inject(ProjectedVectorService)private readonly vectors:ProjectedVectorService,@Inject(SemanticChunkService)private readonly chunks:SemanticChunkService){}
  @Post() @HttpCode(202) @param('caseId') @param('sourceId')
  @ApiOperation({operationId:'POST_api_v1_ingestion_cases_caseId_sources_sourceId_projected_vector',summary:'Queue the exact retained NWIC district profile through the existing fenced source/job authority'})
  @jsonBody(ProjectedVectorRequestSchema) @wireResponse(202,ProjectedVectorStatusSchema,[429])
  enqueue(@Param('caseId')caseId:string,@Param('sourceId')sourceId:string,@Req()request:Request){return readJsonBody(request,JSON_BODY_LIMIT).then(value=>this.vectors.enqueue(caseId,sourceId,value));}
  @Get() @param('caseId') @param('sourceId')
  @ApiOperation({operationId:'GET_api_v1_ingestion_cases_caseId_sources_sourceId_projected_vector',summary:'Read current admission job status and accepted source/transform disposition totals'})
  @wireResponse(200,ProjectedVectorStatusSchema)
  status(@Param('caseId')caseId:string,@Param('sourceId')sourceId:string,@Req()request:Request){queryValues(request,[]);return this.vectors.status(caseId,sourceId);}
  @Get('jobs/:jobId/chunks/:sequence') @param('caseId') @param('sourceId') @param('jobId')
  @ApiOperation({operationId:'GET_api_v1_ingestion_cases_caseId_sources_sourceId_projected_vector_jobs_jobId_chunks_sequence',summary:'Read one immutable committed semantic chunk and its exact source-prefix pin'})
  @ApiParam({name:'sequence',schema:{type:'integer',minimum:1,maximum:128}})
  @wireResponse(200,SemanticChunkResponseSchema)
  chunk(@Param('caseId')caseId:string,@Param('sourceId')sourceId:string,@Param('jobId')jobId:string,@Param('sequence')sequence:string,@Req()request:Request){
    queryValues(request,[]);return this.chunks.chunk(caseId,sourceId,jobId,z.number().int().min(1).max(128).parse(decimal.parse(sequence)));
  }
  @Get('units') @param('caseId') @param('sourceId')
  @ApiOperation({operationId:'GET_api_v1_ingestion_cases_caseId_sources_sourceId_projected_vector_units',summary:'Read at most 25 accepted-generation administrative observation metadata rows, with explicit quarantines'})
  @ApiQuery({name:'cursor',required:false,schema:{type:'integer',minimum:0,maximum:733}})
  @ApiQuery({name:'limit',required:false,schema:{type:'integer',minimum:1,maximum:25}})
  @ApiQuery({name:'chunkSequence',required:false,schema:{type:'integer',minimum:1,maximum:128},description:'Requires exact chunkSha256 and source jobId.'})
  @ApiQuery({name:'chunkSha256',required:false,schema:{type:'string',pattern:'^[a-f0-9]{64}$'}})
  @ApiQuery({name:'jobId',required:false,schema:{type:'string',format:'uuid'},description:'Required for continuation pages; must remain the accepted generation.'})
  @ApiQuery({name:'bbox',required:false,schema:{type:'string'},description:'west,south,east,north in longitude/latitude; only admitted geographic observations can match.'})
  @wireResponse(200,AdministrativeObservationPageSchema)
  page(@Param('caseId')caseId:string,@Param('sourceId')sourceId:string,@Req()request:Request){
    const q=queryValues(request,['cursor','limit','jobId','bbox','chunkSequence','chunkSha256']);
    return this.vectors.page(caseId,sourceId,{...(chunkPin(q)?{chunk:chunkPin(q)}:{}),...(q.cursor!==undefined?{cursor:decimal.parse(q.cursor)}:{}),...(q.limit!==undefined?{limit:decimal.parse(q.limit)}:{}),
      ...(q.jobId!==undefined?{jobId:q.jobId}:{}),...(q.bbox!==undefined?{bbox:q.bbox.split(',').map(value=>value.trim()&&/^-?\d+(?:\.\d+)?$/.test(value)?Number(value):NaN)}:{})});
  }
  @Get('units/:unitId/geometry') @param('caseId') @param('sourceId') @param('unitId')
  @ApiOperation({operationId:'GET_api_v1_ingestion_cases_caseId_sources_sourceId_projected_vector_units_unitId_geometry',summary:'Read one bounded hash-verified native source Feature or admitted geographic context derivative'})
  @ApiQuery({name:'representation',required:false,schema:{type:'string',enum:['native','geographic']}})
  @ApiQuery({name:'chunkSequence',required:false,schema:{type:'integer',minimum:1,maximum:128},description:'Requires exact chunkSha256 and source jobId.'})
  @ApiQuery({name:'chunkSha256',required:false,schema:{type:'string',pattern:'^[a-f0-9]{64}$'}})
  @ApiQuery({name:'jobId',required:false,schema:{type:'string',format:'uuid'}})
  @wireResponse(200,binary)
  async geometry(@Param('caseId')caseId:string,@Param('sourceId')sourceId:string,@Param('unitId')unitId:string,@Req()request:Request,@Res()response:Response){
    const q=queryValues(request,['representation','jobId','chunkSequence','chunkSha256']),representation=z.enum(['native','geographic']).parse(q.representation??'geographic');
    const result=await this.vectors.geometry(caseId,sourceId,unitId,representation,q.jobId,chunkPin(q));
    response.set({'Content-Type':representation==='native'?'application/json':'application/geo+json','Cache-Control':'private, no-store',
      'Content-Length':String(result.bytes.length),'X-Content-SHA256':result.sha256,'X-Source-CRS':result.sourceCrs,'X-Target-CRS':result.targetCrs});
    if(result.chunk)response.set({'X-Source-Chunk-Sequence':String(result.chunk.sequence),'X-Source-Chunk-SHA256':result.chunk.sha256});
    response.send(result.bytes);
  }
}
