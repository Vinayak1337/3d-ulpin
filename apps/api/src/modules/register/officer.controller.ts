import {
  Controller, Get, Header, HttpCode, Inject, Param, Patch, Post, Query, Req, Res, UseGuards,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  BuildingConflictDecisionRequestSchema, BuildingConflictDecisionSchema,
  BuildingPlanCandidateRequestSchema, BuildingPlanCandidateReceiptSchema,
  LevelScheduleRequestSchema, LevelScheduleReceiptSchema,
} from '@ulpin/contracts';
import { PrivateSpatialGuard } from '../spatial/private-spatial.guard';
import { jsonBody, wireResponse } from '../intake/wire-schemas';
import { AppError } from '@ulpin/server/infrastructure/errors';
import { redactDocumentViews } from '@ulpin/server/modules/usp/ingest/redact';
import { readJsonBody } from '../../common/body';
import { jsonResponse, sendWebResponse } from '../../common/response';
import { OfficerService } from './officer.service';
import {
  answerInvestigationInput, associationInput, blockGroupInput,
  createInvestigationInput, detailReviewInput, investigationRequestInput,
  openPreparationInput, placementInput, preparationFactInput,
  prepareDetailsInput, resolveFactInput, updateInvestigationInput, uuid,
} from './input';
import * as doc from './documentation';

async function body<T extends z.ZodType>(request: Request, schema: T): Promise<z.infer<T>> {
  return schema.parse(await readJsonBody(request, 1024 * 1024));
}
const present = <T>(value: T): T => redactDocumentViews(value);
const queryUrl = (request: Request) => new URL(request.originalUrl ?? request.url, 'http://127.0.0.1');

@ApiTags('officer')
@Controller('api/v1')
export class OfficerController {
  constructor(@Inject(OfficerService) private readonly service: OfficerService) {}

  @Post('buildings/:buildingId/conflict-decisions')
  @UseGuards(PrivateSpatialGuard)
  @HttpCode(201)
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ operationId: 'POST_api_v1_buildings_buildingId_conflict_decisions',
    summary: 'Append a checked-page officer conflict decision without deleting source alternatives' })
  @ApiParam({ name: 'buildingId', schema: { type: 'string', format: 'uuid' } })
  @ApiHeader({ name: 'Idempotency-Key', required: true, schema: { type: 'string', format: 'uuid' } })
  @jsonBody(BuildingConflictDecisionRequestSchema)
  @wireResponse(201, BuildingConflictDecisionSchema)
  async conflictDecision(@Param('buildingId') buildingId: string, @Req() req: Request) {
    if (queryUrl(req).search) {
      throw new AppError(422, 'CONFLICT_DECISION_QUERY', 'This command accepts no query fields.');
    }
    const input = await body(req, BuildingConflictDecisionRequestSchema);
    if (uuid.parse(req.header('idempotency-key')) !== input.requestKey) {
      throw new AppError(422, 'CONFLICT_DECISION_KEY', 'Match Idempotency-Key to the decision request key.');
    }
    return this.service.conflictDecision(uuid.parse(buildingId), input);
  }

  @Post('buildings/:buildingId/candidates')
  @UseGuards(PrivateSpatialGuard)
  @HttpCode(201)
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ operationId: 'POST_api_v1_buildings_buildingId_candidates',
    summary: 'Retain plan-local room candidates, reject one or review an existing level association' })
  @ApiParam({ name: 'buildingId', schema: { type: 'string', format: 'uuid' } })
  @ApiHeader({ name: 'Idempotency-Key', required: true, schema: { type: 'string', format: 'uuid' } })
  @jsonBody(BuildingPlanCandidateRequestSchema)
  @wireResponse(201, BuildingPlanCandidateReceiptSchema)
  async candidates(@Param('buildingId') buildingId: string, @Req() req: Request) {
    if (queryUrl(req).search) throw new AppError(422, 'CANDIDATE_QUERY', 'This command accepts no query fields.');
    const input = await body(req, BuildingPlanCandidateRequestSchema);
    if (uuid.parse(req.header('idempotency-key')) !== input.requestKey) {
      throw new AppError(422, 'CANDIDATE_KEY', 'Match Idempotency-Key to the candidate request key.');
    }
    return this.service.candidates(uuid.parse(buildingId), input);
  }

  @Post('buildings/:buildingId/level-schedules')
  @UseGuards(PrivateSpatialGuard)
  @HttpCode(201)
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ operationId: 'POST_api_v1_buildings_buildingId_level_schedules',
    summary: 'Propose or review a cited geometry-free level schedule, retaining conflicts' })
  @ApiParam({ name: 'buildingId', schema: { type: 'string', format: 'uuid' } })
  @ApiHeader({ name: 'Idempotency-Key', required: true, schema: { type: 'string', format: 'uuid' } })
  @jsonBody(LevelScheduleRequestSchema)
  @wireResponse(201, LevelScheduleReceiptSchema)
  async levelSchedule(@Param('buildingId') buildingId: string, @Req() req: Request) {
    if (queryUrl(req).search) throw new AppError(422, 'LEVEL_SCHEDULE_QUERY', 'This command accepts no query fields.');
    const input = await body(req, LevelScheduleRequestSchema);
    if (uuid.parse(req.header('idempotency-key')) !== input.requestKey) {
      throw new AppError(422, 'LEVEL_SCHEDULE_KEY', 'Match Idempotency-Key to the schedule request key.');
    }
    return this.service.levelSchedule(uuid.parse(buildingId), input);
  }

  @Get('work-queue')
  @ApiOperation({ operationId: 'GET_api_v1_work_queue', summary: 'Read the current officer work queue' })
  @ApiQuery({ name: 'page', required: false, schema: { type: 'integer', minimum: 1, maximum: 100000 } })
  @ApiQuery({ name: 'q', required: false, schema: { type: 'string', maxLength: 150 } })
  @ApiQuery({ name: 'status', required: false, schema: { type: 'string', enum: ['all', 'processing', 'recorded'] } })
  @doc.ApiContract(200, doc.workQueue)
  async workQueue(@Req() req: Request) { return present(await this.service.workQueue(queryUrl(req))); }

  @Get('physical-features/:featureId/revisions')
  @ApiOperation({ operationId: 'GET_api_v1_physical_features_featureId_revisions', summary: 'Page retained physical feature revisions' })
  @ApiQuery({ name: 'before', required: false, schema: { type: 'integer', minimum: 1 } })
  @doc.ApiContract(200, doc.revisions)
  async featureRevisions(@Param('featureId') featureId: string, @Query('before') before?: string) {
    const cursor = before === undefined ? 2147483647 : z.coerce.number().int().positive().parse(before);
    return present(await this.service.featureRevisions(uuid.parse(featureId), cursor));
  }

  @Get('areas/:areaId/register')
  @ApiOperation({ operationId: 'GET_api_v1_areas_areaId_register', summary: 'Export a block register at recorded revisions' })
  @ApiQuery({ name: 'format', required: false, schema: { type: 'string', enum: ['json', 'pdf', 'zip'] } })
  @doc.ApiExport(doc.blockRegisterExport, ['pdf', 'zip'])
  async blockRegister(@Param('areaId') areaId: string, @Query('format') format: string | undefined, @Res() res: Response) {
    await sendWebResponse(res, await this.service.blockExport(uuid.parse(areaId),
      z.enum(['json', 'pdf', 'zip']).parse(format ?? 'json')));
  }

  @Get('property-directory')
  @ApiOperation({ operationId: 'GET_api_v1_property_directory', summary: 'Count current detailed records per building in an area' })
  @ApiQuery({ name: 'area', required: true, schema: { type: 'string', format: 'uuid' } })
  @doc.ApiContract(200, doc.propertyDirectory)
  async propertyDirectory(@Query('area') areaId: string) { return present(await this.service.propertyDirectory(uuid.parse(areaId))); }

  @Get('workspace-directory')
  @ApiOperation({ operationId: 'GET_api_v1_workspace_directory', summary: 'List active source preparation workspaces' })
  @doc.ApiContract(200, doc.workspaceDirectory)
  async workspaceDirectory() { return present(await this.service.workspaceDirectory()); }

  @Get('buildings/:buildingId/dossier')
  @ApiOperation({ operationId: 'GET_api_v1_buildings_buildingId_dossier', summary: 'Read a building dossier with actual source and record links' })
  @doc.ApiContract(200, doc.dossier)
  async dossier(@Param('buildingId') buildingId: string) { return present(await this.service.dossier(uuid.parse(buildingId))); }

  @Get('buildings/:buildingId/register')
  @ApiOperation({ operationId: 'GET_api_v1_buildings_buildingId_register', summary: 'Export a building, floor or space register' })
  @ApiQuery({ name: 'format', required: false, schema: { type: 'string', enum: ['json', 'csv', 'html', 'pdf', 'zip'] } })
  @ApiQuery({ name: 'record', required: false, schema: { type: 'string', format: 'uuid' } })
  @ApiQuery({ name: 'profile', required: false, schema: { type: 'string', enum: ['consolidated'] },
    description: 'Opt-in facts-only registry summary. Supports json/html/pdf; omits drawings, measurements and findings.' })
  @ApiQuery({ name: 'includeUnrecorded', required: false, schema: { type: 'boolean', default: false },
    description: 'Consolidated profile only: allow a prominently labelled revision 0 source/import summary from a current active native GeoJSON import. No record selection or registry/legal facts are included.' })
  @doc.ApiExport({ oneOf: [doc.propertyRegisterExport, doc.consolidatedRegistryReport] }, ['csv', 'html', 'pdf', 'zip'])
  async buildingRegister(@Param('buildingId') buildingId: string, @Query('format') format: string | undefined,
    @Query('record') record: string | undefined, @Query('profile') profile: string | undefined,
    @Query('includeUnrecorded') includeUnrecorded: string | undefined, @Res() res: Response) {
    await sendWebResponse(res, await this.service.registerExport(uuid.parse(buildingId),
      z.enum(['json', 'csv', 'html', 'pdf', 'zip']).parse(format ?? 'json'), undefined,
      record === undefined ? undefined : uuid.parse(record), profile === undefined ? undefined : z.literal('consolidated').parse(profile),
      includeUnrecorded === undefined ? false : z.enum(['true', 'false']).parse(includeUnrecorded) === 'true'));
  }

  @Post('buildings/:buildingId/preparation-cases')
  @HttpCode(201)
  @ApiOperation({ operationId: 'POST_api_v1_buildings_buildingId_preparation_cases', summary: 'Open or reuse a building preparation case' })
  @doc.ApiContract(201, doc.preparationCase, openPreparationInput)
  async openPreparation(@Param('buildingId') buildingId: string, @Req() req: Request) {
    const input = await body(req, openPreparationInput);
    return present(await this.service.openPreparation(uuid.parse(buildingId), input.expectedRevision));
  }

  @Post('buildings/:buildingId/detail-review')
  @HttpCode(201)
  @ApiOperation({ operationId: 'POST_api_v1_buildings_buildingId_detail_review', summary: 'Prepare or reuse a detailed registry review' })
  @doc.ApiContract(201, doc.registryReview, detailReviewInput)
  @ApiResponse({ status: 200, schema: doc.registryReview as never, description: 'Existing current review reused' })
  async detailReview(@Param('buildingId') buildingId: string, @Req() req: Request, @Res() res: Response) {
    const input = await body(req, detailReviewInput);
    const result = await this.service.detailReview(uuid.parse(buildingId), input.expectedRevision);
    await sendWebResponse(res, jsonResponse(present(result.review), result.created ? 201 : 200));
  }

  @Post('property-associations')
  @HttpCode(201)
  @ApiOperation({ operationId: 'POST_api_v1_property_associations', summary: 'Record an evidenced property association' })
  @doc.ApiContract(201, doc.association, associationInput)
  async association(@Req() req: Request) { return present(await this.service.association(await body(req, associationInput))); }

  @Post('block-groups')
  @HttpCode(201)
  @ApiOperation({ operationId: 'POST_api_v1_block_groups', summary: 'Record an evidenced named block group' })
  @doc.ApiContract(201, doc.blockGroup, blockGroupInput)
  async group(@Req() req: Request) { return present(await this.service.group(await body(req, blockGroupInput))); }

  @Get('import-packages/:packageId/continuation')
  @ApiOperation({ operationId: 'GET_api_v1_import_packages_packageId_continuation', summary: 'Read current preparation continuation' })
  @doc.ApiContract(200, doc.continuation)
  async continuation(@Param('packageId') packageId: string) { return present(await this.service.continuation(uuid.parse(packageId))); }

  @Get('import-packages/:packageId/requirements')
  @ApiOperation({ operationId: 'GET_api_v1_import_packages_packageId_requirements', summary: 'Read unresolved preparation requirements' })
  @doc.ApiContract(200, doc.requirements)
  async requirements(@Param('packageId') packageId: string) { return present(await this.service.requirements(uuid.parse(packageId))); }

  @Post('import-packages/:packageId/preparation-facts')
  @HttpCode(201)
  @ApiOperation({ operationId: 'POST_api_v1_import_packages_packageId_preparation_facts', summary: 'Append a human entered, source cited fact' })
  @doc.ApiContract(201, doc.importPackage, preparationFactInput)
  async fact(@Param('packageId') packageId: string, @Req() req: Request) {
    return present(await this.service.fact(uuid.parse(packageId), await body(req, preparationFactInput)));
  }

  @Post('import-packages/:packageId/resolve-fact')
  @HttpCode(200)
  @ApiOperation({ operationId: 'POST_api_v1_import_packages_packageId_resolve_fact', summary: 'Resolve a conflicting source claim' })
  @doc.ApiContract(200, doc.importPackage, resolveFactInput)
  async resolveFact(@Param('packageId') packageId: string, @Req() req: Request) {
    const input = await body(req, resolveFactInput);
    return present(await this.service.resolveFact(uuid.parse(packageId), input.expectedRevision, input.claimId, input.reason));
  }

  @Post('import-packages/:packageId/placement')
  @HttpCode(200)
  @ApiOperation({ operationId: 'POST_api_v1_import_packages_packageId_placement', summary: 'Review evidenced local placement' })
  @doc.ApiContract(200, doc.preparationCase, placementInput)
  async placement(@Param('packageId') packageId: string, @Req() req: Request) {
    return present(await this.service.placement(uuid.parse(packageId), await body(req, placementInput)));
  }

  @Post('import-packages/:packageId/prepare-details')
  @HttpCode(201)
  @ApiOperation({ operationId: 'POST_api_v1_import_packages_packageId_prepare_details', summary: 'Build the current supported detailed geometry' })
  @doc.ApiContract(201, doc.preparedDetailsReceipt, prepareDetailsInput)
  async prepareDetails(@Param('packageId') packageId: string, @Req() req: Request) {
    const input = await body(req, prepareDetailsInput);
    return present(await this.service.prepareDetails(uuid.parse(packageId), input.expectedRevision));
  }

  @Post('investigations')
  @HttpCode(201)
  @ApiOperation({ operationId: 'POST_api_v1_investigations', summary: 'Open an investigation pinned to current evidence' })
  @doc.ApiContract(201, doc.investigation, createInvestigationInput)
  async createInvestigation(@Req() req: Request) {
    return present(await this.service.createInvestigation(await body(req, createInvestigationInput)));
  }

  @Get('investigations/:investigationId')
  @ApiOperation({ operationId: 'GET_api_v1_investigations_investigationId', summary: 'Read a retained investigation' })
  @doc.ApiContract(200, doc.investigation)
  async investigation(@Param('investigationId') id: string) { return present(await this.service.investigation(uuid.parse(id))); }

  @Patch('investigations/:investigationId')
  @ApiOperation({ operationId: 'PATCH_api_v1_investigations_investigationId', summary: 'Update an investigation at the expected revision' })
  @doc.ApiContract(200, doc.investigation, updateInvestigationInput)
  async updateInvestigation(@Param('investigationId') id: string, @Req() req: Request) {
    return present(await this.service.updateInvestigation(uuid.parse(id), await body(req, updateInvestigationInput)));
  }

  @Post('investigations/:investigationId/requests')
  @HttpCode(201)
  @ApiOperation({ operationId: 'POST_api_v1_investigations_investigationId_requests', summary: 'Request additional evidence' })
  @doc.ApiContract(201, doc.investigation, investigationRequestInput)
  async requestEvidence(@Param('investigationId') id: string, @Req() req: Request) {
    const input = await body(req, investigationRequestInput);
    return present(await this.service.requestEvidence(uuid.parse(id), input.expectedRevision, input.question));
  }

  @Post('investigations/:investigationId/requests/:requestId/answer')
  @HttpCode(200)
  @ApiOperation({ operationId: 'POST_api_v1_investigations_investigationId_requests_requestId_answer', summary: 'Answer an evidence request with retained locators' })
  @doc.ApiContract(200, doc.investigation, answerInvestigationInput)
  async answerEvidence(@Param('investigationId') id: string, @Param('requestId') requestId: string, @Req() req: Request) {
    const input = await body(req, answerInvestigationInput);
    return present(await this.service.answerEvidence(uuid.parse(id), input.expectedRevision,
      uuid.parse(requestId), input.response, input.evidence));
  }

  @Get('investigations/:investigationId/export')
  @ApiOperation({ operationId: 'GET_api_v1_investigations_investigationId_export', summary: 'Export a pinned investigation register' })
  @ApiQuery({ name: 'format', required: false, schema: { type: 'string', enum: ['json', 'csv', 'html', 'pdf'] } })
  @doc.ApiExport(doc.propertyRegisterExport, ['csv', 'html', 'pdf'])
  async investigationExport(@Param('investigationId') id: string, @Query('format') format: string | undefined,
    @Res() res: Response) {
    const investigationId = uuid.parse(id);
    const investigation = await this.service.investigation(investigationId);
    await sendWebResponse(res, await this.service.registerExport(investigation.buildingId,
      z.enum(['json', 'csv', 'html', 'pdf']).parse(format ?? 'json'), investigationId));
  }
}
