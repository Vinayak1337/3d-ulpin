import { Controller, Get, HttpCode, Inject, Param, Patch, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Request, Response as ExpressResponse } from 'express';
import { AppError } from '@ulpin/server/infrastructure/errors';
import {
  addUnitSchema, applyLevelsSchema, buildSchema, createCaseSchema, demoSchema,
  editUnitSchema, idSchema, prepareSchema, profileSchema,
} from '@ulpin/server/infrastructure/validation';
import { CaseIntakeService } from '@ulpin/server/modules/cases/case-intake-service';
import { JSON_BODY_LIMIT, MULTIPART_BODY_LIMIT, readJsonBody, readMultipartBody } from '../../common/body';
import { sendWebResponse } from '../../common/response';
import {
  binary, caseDetail, caseRecord, demoInputs, job, jsonBody, multipartBody,
  sourceRevision, unit, wireResponse,
} from './wire-schemas';
import { z } from 'zod';
import { pipeline } from 'node:stream/promises';
import { PrivateSpatialGuard } from '../spatial/private-spatial.guard';

function uploadFile(form: FormData, message: string): File {
  const file = form.get('file');
  if (!(file instanceof File)) throw new AppError(400, 'MISSING_FILE', message);
  return file;
}
function download(bytes: Uint8Array, mimeType: string, disposition: string, cacheControl='private, max-age=60') {
  return new globalThis.Response(new Uint8Array(bytes), {headers: {
    'Content-Type': mimeType, 'Content-Disposition': disposition,
    'Cache-Control': cacheControl, 'X-Content-Type-Options': 'nosniff',
  }});
}

@ApiTags('intake-cases')
@Controller('api/v1')
export class CasesController {
  constructor(@Inject(CaseIntakeService) private readonly cases: CaseIntakeService) {}

  @Get('demo-assets/real-nyc/:asset')
  @ApiOperation({operationId: 'GET_api_v1_demo_assets_real_nyc_asset', summary: 'Download a retained official-derived NYC original or provenance file'})
  @ApiParam({name: 'asset', schema: {type: 'string', enum: ['original.geojson', 'provenance.json']}})
  @wireResponse(200, binary)
  async realNycAsset(@Param('asset') asset: string, @Res() response: ExpressResponse) {
    const bytes = await this.cases.realNycAsset(asset);
    await sendWebResponse(response, download(bytes, asset.endsWith('.geojson') ? 'application/geo+json' : 'application/json', `attachment; filename="${asset}"`));
  }

  @Get('demo-files/:caseId/:filename')
  @ApiOperation({operationId: 'GET_api_v1_demo_files_caseId_filename', summary: 'Download a retained real-nyc derived input'})
  @ApiParam({name: 'caseId', schema: {type: 'string', enum: ['real-nyc']}})
  @ApiParam({name: 'filename', schema: {type: 'string', enum: ['spatial.json', 'levels-r1.csv']}})
  @wireResponse(200, binary)
  async demoFile(@Param('caseId') dataset: string, @Param('filename') filename: string, @Res() response: ExpressResponse) {
    const file = await this.cases.demoFile(dataset, filename);
    await sendWebResponse(response, download(file.bytes, file.mime, `attachment; filename="${filename}"`));
  }

  @Get('sources/:sourceId/file')
  @UseGuards(PrivateSpatialGuard)
  @ApiOperation({operationId: 'GET_api_v1_sources_sourceId_file', summary: 'Download an unchanged private source original'})
  @ApiParam({name: 'sourceId', schema: {type: 'string', format: 'uuid'}})
  @wireResponse(200, binary, [416,429])
  async sourceFile(@Param('sourceId') sourceId: string, @Res() response: ExpressResponse, @Req() request:Request) {
    const id=idSchema.parse(sourceId),controller=new AbortController();
    const disconnect=()=>{if(!response.writableFinished)controller.abort();};
    response.once('close',disconnect);
    let streamed:Awaited<ReturnType<CaseIntakeService['streamedSourceFile']>>=null;
    try{
      streamed=await this.cases.streamedSourceFile(id,controller.signal);
      if(streamed){
        if(request.headers.range)throw new AppError(416,'SOURCE_RANGE_UNSUPPORTED','This integrity-checked original download supports the complete bounded object only.');
        response.set({'Content-Type':streamed.mimeType,'Content-Length':String(streamed.bytes),
          'Content-Disposition':`inline; filename*=UTF-8''${encodeURIComponent(streamed.name)}`,'Cache-Control':'private, max-age=60',
          'X-Content-Type-Options':'nosniff','X-Source-Sha256':streamed.sha256,
          'X-Source-Integrity':'recomputed-before-response; conditional-sealed-read; checked-at-stream-end','Accept-Ranges':'none'});
        try{await pipeline(streamed.body,streamed.integrity,response,{signal:controller.signal});}
        catch(error){console.warn(JSON.stringify({event:'large-original-transfer-failed',sourceId:id,
          code:error instanceof AppError?error.code:'STREAM_INTERRUPTED',headersSent:response.headersSent,
          bytesMayHaveBeenSent:response.headersSent}));response.destroy();throw error;}
        return;
      }
      const file = await this.cases.sourceFile(id);
      await sendWebResponse(response, download(file.bytes, file.mimeType, `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`,
        'cacheControl' in file?file.cacheControl:undefined));
    }finally{streamed?.close();response.off('close',disconnect);controller.abort();}
  }

  @Post('jobs/:jobId/retry')
  @HttpCode(202)
  @ApiOperation({operationId: 'POST_api_v1_jobs_jobId_retry', summary: 'Retry a failed or stale canonical job'})
  @ApiParam({name: 'jobId', schema: {type: 'string', format: 'uuid'}})
  @wireResponse(202, job)
  retry(@Param('jobId') jobId: string) { return this.cases.retry(idSchema.parse(jobId)); }

  @Get('cases')
  @HttpCode(200)
  @ApiOperation({operationId: 'GET_api_v1_cases', summary: 'List case workspaces'})
  @wireResponse(200, z.array(caseRecord))
  list() { return this.cases.list(); }

  @Post('cases')
  @HttpCode(201)
  @ApiOperation({operationId: 'POST_api_v1_cases', summary: 'Create a case workspace with an unassigned frame'})
  @jsonBody(createCaseSchema)
  @wireResponse(201, caseRecord)
  async create(@Req() request: Request) {
    const input = createCaseSchema.parse(await readJsonBody(request, JSON_BODY_LIMIT));
    return this.cases.create(input.name, input.description);
  }

  @Get('cases/:caseId')
  @HttpCode(200)
  @ApiOperation({operationId: 'GET_api_v1_cases_caseId', summary: 'Read case sources, jobs and records'})
  @ApiParam({name: 'caseId', schema: {type: 'string', format: 'uuid'}})
  @wireResponse(200, caseDetail)
  detail(@Param('caseId') caseId: string) { return this.cases.detail(idSchema.parse(caseId)); }

  @Post('cases/:caseId/sources')
  @HttpCode(201)
  @ApiOperation({operationId: 'POST_api_v1_cases_caseId_sources', summary: 'Retain a bounded source original and queue canonical inspection'})
  @ApiHeader({name: 'Idempotency-Key', required: false, schema: {type: 'string'}})
  @multipartBody(['file', 'profile'], {
    profile: {type: 'string', enum: profileSchema.options},
    familyId: {type: 'string', format: 'uuid'},
  })
  @wireResponse(201, sourceRevision)
  async upload(@Param('caseId') caseId: string, @Req() request: Request) {
    const form = await readMultipartBody(request, MULTIPART_BODY_LIMIT);
    const file = uploadFile(form, 'Choose a file to upload.');
    const profile = profileSchema.parse(form.get('profile'));
    const familyId = form.get('familyId') ? idSchema.parse(form.get('familyId')) : undefined;
    const mimeType = {
      'parcel-local-json-v1': 'application/json', 'levels-csv-v1': 'text/csv',
      'control-csv-v1': 'text/csv', 'plan-png-v1': 'image/png', 'plan-pdf-v1': 'application/pdf',
    }[profile];
    return this.cases.upload(idSchema.parse(caseId), {
      name: file.name, bytes: new Uint8Array(await file.arrayBuffer()), mimeType, profile, familyId,
      operationKey: request.headers['idempotency-key']?.toString() || undefined,
    });
  }

  @Post('cases/:caseId/demo-inputs')
  @HttpCode(201)
  @ApiOperation({operationId: 'POST_api_v1_cases_caseId_demo_inputs', summary: 'Retain only the real-nyc official-derived input pair'})
  @ApiHeader({name: 'Idempotency-Key', required: false, schema: {type: 'string'}})
  @jsonBody(demoSchema)
  @wireResponse(201, demoInputs)
  async realNycInputs(@Param('caseId') caseId: string, @Req() request: Request) {
    const input = demoSchema.parse(await readJsonBody(request, JSON_BODY_LIMIT));
    return this.cases.loadRealNycInputs(
      idSchema.parse(caseId), input.dataset, request.headers['idempotency-key']?.toString() || undefined,
    );
  }

  @Post('cases/:caseId/prepare')
  @HttpCode(200)
  @ApiOperation({operationId: 'POST_api_v1_cases_caseId_prepare', summary: 'Prepare inspected source geometry and optional levels'})
  @jsonBody(prepareSchema)
  @wireResponse(200, caseDetail)
  async prepare(@Param('caseId') caseId: string, @Req() request: Request) {
    return this.cases.prepare(idSchema.parse(caseId), prepareSchema.parse(await readJsonBody(request, JSON_BODY_LIMIT)));
  }

  @Post('cases/:caseId/apply-levels')
  @HttpCode(200)
  @ApiOperation({operationId: 'POST_api_v1_cases_caseId_apply_levels', summary: 'Apply source-supported levels at an expected case revision'})
  @jsonBody(applyLevelsSchema)
  @wireResponse(200, caseDetail)
  async applyLevels(@Param('caseId') caseId: string, @Req() request: Request) {
    return this.cases.applyLevels(idSchema.parse(caseId), applyLevelsSchema.parse(await readJsonBody(request, JSON_BODY_LIMIT)));
  }

  @Post('cases/:caseId/build')
  @HttpCode(202)
  @ApiOperation({operationId: 'POST_api_v1_cases_caseId_build', summary: 'Queue the canonical case build'})
  @jsonBody(buildSchema)
  @wireResponse(202, job)
  async build(@Param('caseId') caseId: string, @Req() request: Request) {
    const {expectedRevision} = buildSchema.parse(await readJsonBody(request, JSON_BODY_LIMIT));
    return this.cases.build(idSchema.parse(caseId), expectedRevision);
  }

  @Post('cases/:caseId/units')
  @HttpCode(201)
  @ApiOperation({operationId: 'POST_api_v1_cases_caseId_units', summary: 'Add a locally framed case unit'})
  @jsonBody(addUnitSchema)
  @wireResponse(201, unit)
  async addUnit(@Param('caseId') caseId: string, @Req() request: Request) {
    return this.cases.addUnit(idSchema.parse(caseId), addUnitSchema.parse(await readJsonBody(request, JSON_BODY_LIMIT)));
  }

  @Patch('cases/:caseId/units/:unitId')
  @HttpCode(200)
  @ApiOperation({operationId: 'PATCH_api_v1_cases_caseId_units_unitId', summary: 'Revise a unit with its expected unit revision'})
  @jsonBody(editUnitSchema.describe('Supply at least one outline, elevation or calibration change. expectedRevision is the unit revision.'))
  @wireResponse(200, unit)
  async updateUnit(@Param('caseId') caseId: string, @Param('unitId') unitId: string, @Req() request: Request) {
    return this.cases.updateUnit(idSchema.parse(caseId), idSchema.parse(unitId), editUnitSchema.parse(await readJsonBody(request, JSON_BODY_LIMIT)));
  }
}
