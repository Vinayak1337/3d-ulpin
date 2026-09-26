import { Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import { AppError } from '@ulpin/server/infrastructure/errors';
import { redactDocumentViews } from '@ulpin/server/modules/usp/ingest/redact';
import { AreaIntakeService } from '@ulpin/server/modules/areas/area-intake-service';
import {
  acquisitionProbeSchema, acquisitionSchema, areaIdSchema, documentFormatSchema,
  externalIdentifierSchema,
} from '@ulpin/server/modules/areas/area-validation';
import { sourceCaseSchema } from '@ulpin/server/modules/cases/source-cases';
import { sourceWorkspaceSchema } from '@ulpin/server/modules/cases/source-workspaces';
import { JSON_BODY_LIMIT, MULTIPART_BODY_LIMIT, readJsonBody, readMultipartBody } from '../../common/body';
import {
  acquisition, acquisitionProbe, areaContext, caseDocument, externalIdentifier,
  importPackage, jsonBody, mapArea, multipartBody, resolvedIdentifier, retiredBranchResponse, sourceCase,
  sourceCatalog, wireResponse,
} from './wire-schemas';

@ApiTags('intake-areas')
@Controller('api/v1')
export class AreaSourcesController {
  constructor(@Inject(AreaIntakeService) private readonly areas: AreaIntakeService) {}

  @Post('source-cases')
  @HttpCode(201)
  @ApiOperation({operationId: 'POST_api_v1_source_cases', summary: 'Create an idempotent unassigned source case'})
  @jsonBody(sourceCaseSchema)
  @wireResponse(201, sourceCase)
  async sourceCase(@Req() request: Request) {
    return this.areas.createSourceCase(sourceCaseSchema.parse(await readJsonBody(request, JSON_BODY_LIMIT)));
  }

  @Post('cases/:caseId/reference-documents')
  @HttpCode(201)
  @ApiOperation({operationId: 'POST_api_v1_cases_caseId_reference_documents', summary: 'Retain a bounded source case document original'})
  @ApiParam({name: 'caseId', schema: {type: 'string', format: 'uuid'}})
  @multipartBody(['file', 'format', 'requestKey'], {
    format: {type: 'string', enum: documentFormatSchema.options},
    requestKey: {type: 'string', format: 'uuid'},
  })
  @wireResponse(201, caseDocument)
  async referenceDocument(@Param('caseId') caseId: string, @Req() request: Request) {
    const form = await readMultipartBody(request, MULTIPART_BODY_LIMIT);
    const file = form.get('file');
    if (!(file instanceof File)) throw new AppError(400, 'MISSING_FILE', 'Choose a supporting document.');
    return this.areas.receiveCaseDocument(areaIdSchema.parse(caseId), {
      bytes: new Uint8Array(await file.arrayBuffer()), name: file.name,
      format: documentFormatSchema.parse(form.get('format')),
      entityIds: [], requestKey: areaIdSchema.parse(form.get('requestKey')),
    });
  }

  @Get('source-workspaces')
  @HttpCode(200)
  @ApiOperation({operationId: 'GET_api_v1_source_workspaces', summary: 'Read a source workspace for one case'})
  @ApiQuery({name: 'caseId', required: true, schema: {type: 'string', format: 'uuid'}})
  @wireResponse(200, z.nullable(importPackage))
  async sourceWorkspace(@Query('caseId') caseId: string) {
    return redactDocumentViews(await this.areas.sourceWorkspaceForCase(areaIdSchema.parse(caseId)));
  }

  @Post('source-workspaces')
  @HttpCode(201)
  @ApiOperation({operationId: 'POST_api_v1_source_workspaces', summary: 'Create a source-only package without an invented property'})
  @jsonBody(sourceWorkspaceSchema)
  @wireResponse(201, importPackage)
  async createSourceWorkspace(@Req() request: Request) {
    return redactDocumentViews(await this.areas.createSourceWorkspace(sourceWorkspaceSchema.parse(await readJsonBody(request, JSON_BODY_LIMIT))));
  }

  @Get('source-catalog')
  @HttpCode(200)
  @ApiOperation({operationId: 'GET_api_v1_source_catalog', summary: 'Read curated issuer and permission metadata'})
  @wireResponse(200, sourceCatalog)
  catalog() { return this.areas.catalog(); }

  @Get('areas')
  @HttpCode(200)
  @ApiOperation({operationId: 'GET_api_v1_areas', summary: 'List retained area scopes'})
  @wireResponse(200, z.array(mapArea))
  async list() { return redactDocumentViews(await this.areas.listAreas()); }

  @Get('areas/:areaId/context')
  @HttpCode(200)
  @ApiOperation({operationId: 'GET_api_v1_areas_areaId_context', summary: 'Read area records, packages and checks'})
  @ApiParam({name: 'areaId', schema: {type: 'string', format: 'uuid'}})
  @wireResponse(200, areaContext)
  async context(@Param('areaId') areaId: string) {
    return redactDocumentViews(await this.areas.context(areaIdSchema.parse(areaId)));
  }

  @Post('areas/:areaId/scenario')
  @HttpCode(410)
  @ApiOperation({operationId: 'POST_api_v1_areas_areaId_scenario', summary: 'Retired authored crossing generator'})
  @ApiResponse({status: 410, schema: {type: 'object', required: ['error'], properties: {
    error: {type: 'object', required: ['code', 'message', 'requestId'], properties: {
      code: {type: 'string', enum: ['RETIRED_OPERATION']}, message: {type: 'string'},
      requestId: {type: 'string', format: 'uuid'},
    }},
  }}})
  scenario(): never {
    return this.areas.retiredScenario();
  }

  @Get('resolve')
  @HttpCode(200)
  @ApiOperation({operationId: 'GET_api_v1_resolve', summary: 'Resolve an identifier against retained area and registry records'})
  @ApiQuery({name: 'identifier', required: true, schema: {type: 'string', minLength: 1, maxLength: 150}})
  @wireResponse(200, resolvedIdentifier)
  async resolve(@Query('identifier') identifier: string) {
    return redactDocumentViews(await this.areas.resolve(z.string().trim().min(1).max(150).parse(identifier)));
  }

  @Post('external-identifiers')
  @HttpCode(201)
  @ApiOperation({operationId: 'POST_api_v1_external_identifiers', summary: 'Bind a sourced external identifier to a current record'})
  @jsonBody(externalIdentifierSchema)
  @retiredBranchResponse()
  @wireResponse(201, externalIdentifier)
  async bindIdentifier(@Req() request: Request) {
    return redactDocumentViews(await this.areas.bindIdentifier(externalIdentifierSchema.parse(await readJsonBody(request, JSON_BODY_LIMIT))));
  }

  @Post('acquisitions/probe')
  @HttpCode(200)
  @ApiOperation({operationId: 'POST_api_v1_acquisitions_probe', summary: 'Check a curated acquisition source'})
  @jsonBody(acquisitionProbeSchema)
  @wireResponse(200, acquisitionProbe)
  async probe(@Req() request: Request) {
    const {sourceId} = acquisitionProbeSchema.parse(await readJsonBody(request, JSON_BODY_LIMIT));
    return redactDocumentViews(await this.areas.probe(sourceId));
  }

  @Post('acquisitions')
  @HttpCode(201)
  @ApiOperation({operationId: 'POST_api_v1_acquisitions', summary: 'Retain curated saved bytes or request an allowed provider refresh'})
  @jsonBody(acquisitionSchema)
  @wireResponse(201, acquisition)
  async acquire(@Req() request: Request) {
    const input = acquisitionSchema.parse(await readJsonBody(request, JSON_BODY_LIMIT));
    return redactDocumentViews(await this.areas.acquire(input.sourceId, input.mode, input.requestKey));
  }

  @Get('acquisitions/:acquisitionId')
  @HttpCode(200)
  @ApiOperation({operationId: 'GET_api_v1_acquisitions_acquisitionId', summary: 'Read retained acquisition receipt and source lineage'})
  @ApiParam({name: 'acquisitionId', schema: {type: 'string', format: 'uuid'}})
  @wireResponse(200, acquisition)
  async acquisition(@Param('acquisitionId') id: string) {
    return redactDocumentViews(await this.areas.acquisition(areaIdSchema.parse(id)));
  }
}
