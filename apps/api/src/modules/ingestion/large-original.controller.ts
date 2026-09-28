import { Controller, Get, HttpCode, Inject, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBody, ApiConsumes, ApiHeader, ApiOperation, ApiParam } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import { LARGE_ORIGINAL_LIMITS, LARGE_ORIGINAL_V2_LIMITS, LargeUploadCreateSchema, LargeUploadGuardSchema, LargeUploadFinalizeSchema,
  LargeUploadPartSchema, LargeUploadStatusSchema } from '@ulpin/contracts/usp';
import { LargeOriginalService } from '@ulpin/server/modules/usp/ingestion/large-original';
import { AppError } from '@ulpin/server/infrastructure/errors';
import { readBoundedBytes, readJsonBody } from '../../common/body';
import { jsonBody, wireResponse } from '../intake/wire-schemas';
import { PrivateSpatialGuard } from '../spatial/private-spatial.guard';

const param=(name:string)=>ApiParam({name,schema:{type:'string',format:'uuid'}});
const limitsSchema=z.object({limits:z.object(Object.fromEntries(Object.entries(LARGE_ORIGINAL_LIMITS).map(([key,value])=>[key,z.literal(value)]))),
  largeProfile:z.object({limits:z.object(Object.fromEntries(Object.entries(LARGE_ORIGINAL_V2_LIMITS).map(([key,value])=>[key,z.literal(value)]))),
    capacity:z.object({available:z.boolean(),fullCeilingConfigured:z.boolean(),configuredBytes:z.number().int().nonnegative(),requiredBytes:z.number().int().positive()})}),
  profile:z.literal('opaque_original_only'),conversion:z.literal('unsupported')});
let rawReaders=0;
@UseGuards(PrivateSpatialGuard)
@Controller('api/v1/ingestion')
export class LargeOriginalController {
  constructor(@Inject(LargeOriginalService) private readonly uploads:LargeOriginalService){}
  @Get('upload-limits')
  @ApiOperation({operationId:'GET_api_v1_ingestion_upload_limits',summary:'Read bounded large-original byte receipt limits; semantic conversion is unsupported'})
  @wireResponse(200,limitsSchema)
  limits(){return {limits:LARGE_ORIGINAL_LIMITS,largeProfile:{limits:LARGE_ORIGINAL_V2_LIMITS,capacity:this.uploads.capacity()},
    profile:'opaque_original_only',conversion:'unsupported'};}

  @Post('cases/:caseId/uploads') @HttpCode(201) @param('caseId')
  @ApiOperation({operationId:'POST_api_v1_ingestion_cases_caseId_uploads',summary:'Admit a bounded resumable opaque original in the current source case'})
  @jsonBody(LargeUploadCreateSchema) @wireResponse(201,LargeUploadStatusSchema,[429,503])
  async create(@Param('caseId') caseId:string,@Req() request:Request){return this.uploads.create(caseId,await readJsonBody(request));}

  @Get('cases/:caseId/uploads/:uploadId') @param('caseId') @param('uploadId')
  @ApiOperation({operationId:'GET_api_v1_ingestion_cases_caseId_uploads_uploadId',summary:'Read durable receipt, byte-part progress and current case/upload revisions'})
  @wireResponse(200,LargeUploadStatusSchema)
  status(@Param('caseId') caseId:string,@Param('uploadId') uploadId:string){return this.uploads.read(caseId,uploadId);}

  @Put('cases/:caseId/uploads/:uploadId/parts/:partNumber') @HttpCode(200) @param('caseId') @param('uploadId')
  @ApiParam({name:'partNumber',schema:{type:'integer',minimum:1,maximum:LARGE_ORIGINAL_V2_LIMITS.maxParts}})
  @ApiOperation({operationId:'PUT_api_v1_ingestion_cases_caseId_uploads_uploadId_parts_partNumber',summary:'Receive one bounded raw byte part with actual server hash and immutable request binding'})
  @ApiConsumes('application/octet-stream') @ApiBody({schema:{type:'string',format:'binary'}})
  @ApiHeader({name:'X-Request-Key',required:true,schema:{type:'string',format:'uuid'}})
  @ApiHeader({name:'X-Upload-Revision',required:true,schema:{type:'integer',minimum:1}})
  @ApiHeader({name:'X-Case-Revision',required:true,schema:{type:'integer',minimum:0}})
  @ApiHeader({name:'X-Part-Sha256',required:true,schema:{type:'string',pattern:'^[a-f0-9]{64}$'}})
  @wireResponse(200,LargeUploadStatusSchema,[408,410,429])
  async part(@Param('caseId') caseId:string,@Param('uploadId') uploadId:string,@Param('partNumber') partNumber:string,@Req() request:Request){
    if(request.headers['content-type']!=='application/octet-stream')throw new AppError(415,'UPLOAD_MEDIA_TYPE','Send one raw application/octet-stream byte part.');
    if(rawReaders>=LARGE_ORIGINAL_LIMITS.maxActiveGlobal)throw new AppError(429,'UPLOAD_CONCURRENCY','The bounded byte-part reader allowance is full.');
    const input=LargeUploadPartSchema.parse({partNumber:Number(partNumber),requestKey:request.header('x-request-key'),
      expectedRevision:Number(request.header('x-upload-revision')),expectedCaseRevision:Number(request.header('x-case-revision')),sha256:request.header('x-part-sha256')});
    rawReaders++;
    let claim:Awaited<ReturnType<LargeOriginalService['claimPart']>>|undefined;
    try{
      claim=await this.uploads.claimPart(caseId,uploadId,input);
      const bytes=await readBoundedBytes(request,claim.bytes,LARGE_ORIGINAL_LIMITS.partRequestSeconds*1000);
      return await this.uploads.receivePart(claim,bytes);
    }catch(error){if(claim)await this.uploads.failPart(claim);throw error;}
    finally{rawReaders--;}
  }
  @Post('cases/:caseId/uploads/:uploadId/finalize') @HttpCode(200) @param('caseId') @param('uploadId')
  @ApiOperation({operationId:'POST_api_v1_ingestion_cases_caseId_uploads_uploadId_finalize',summary:'Finalize v1 inline or queue recoverable v2 hash verification and original publication'})
  @jsonBody(LargeUploadFinalizeSchema) @wireResponse(200,LargeUploadStatusSchema,[410,429])
  async finalize(@Param('caseId') caseId:string,@Param('uploadId') uploadId:string,@Req() request:Request){return this.uploads.finalize(caseId,uploadId,await readJsonBody(request));}

  @Post('cases/:caseId/uploads/:uploadId/abort') @HttpCode(200) @param('caseId') @param('uploadId')
  @ApiOperation({operationId:'POST_api_v1_ingestion_cases_caseId_uploads_uploadId_abort',summary:'Fence one incomplete upload and safely reclaim only its owned temporary objects'})
  @jsonBody(LargeUploadGuardSchema) @wireResponse(200,LargeUploadStatusSchema)
  async abort(@Param('caseId') caseId:string,@Param('uploadId') uploadId:string,@Req() request:Request){return this.uploads.abort(caseId,uploadId,await readJsonBody(request));}

  @Post('cases/:caseId/uploads/:uploadId/cleanup') @HttpCode(200) @param('caseId') @param('uploadId')
  @ApiOperation({operationId:'POST_api_v1_ingestion_cases_caseId_uploads_uploadId_cleanup',summary:'Resume scoped temporary-object cleanup without deleting a canonical retained original'})
  @jsonBody(LargeUploadGuardSchema) @wireResponse(200,LargeUploadStatusSchema)
  async cleanup(@Param('caseId') caseId:string,@Param('uploadId') uploadId:string,@Req() request:Request){return this.uploads.cleanup(caseId,uploadId,await readJsonBody(request));}
}
