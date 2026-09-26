import { Controller, Get, HttpCode, Inject, Param, Patch, Post, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import { idSchema } from '@ulpin/server/infrastructure/validation';
import { readBoundedBytes, readJsonBody } from '../../common/body';
import { sendWebResponse } from '../../common/response';
import { RegisterService } from './register.service';
import {
  commitReviewInput, createDraftInput, createSiteInput, editDraftSchema,
  importSiteInput, querySchema, registryImportInput, reviewDraftInput,
} from './input';
import * as doc from './documentation';

async function body<T extends z.ZodType>(request: Request, schema: T): Promise<z.infer<T>> {
  return schema.parse(await readJsonBody(request, 2 * 1024 * 1024));
}

@ApiTags('registry')
@Controller('api/v1')
export class RegisterController {
  constructor(@Inject(RegisterService) private readonly service: RegisterService) {}

  @Post('registry-imports')
  @HttpCode(201)
  @ApiOperation({ operationId: 'POST_api_v1_registry_imports', summary: 'Import a current case into a separate registry site' })
  @doc.ApiContract(201, doc.importedDraftEnvelope, registryImportInput)
  async registryImport(@Req() req: Request) {
    const input = await body(req, registryImportInput);
    return this.service.importCase(null, input.caseId, input.expectedRevision);
  }

  @Get('sites')
  @ApiOperation({ operationId: 'GET_api_v1_sites', summary: 'List registry sites' })
  @doc.ApiContract(200, { type: 'array', items: doc.registrySite })
  sites() { return this.service.listSites(); }

  @Post('sites')
  @HttpCode(201)
  @ApiOperation({ operationId: 'POST_api_v1_sites', summary: 'Create a registry site in a declared local frame' })
  @doc.ApiContract(201, doc.registrySite, createSiteInput)
  async createSite(@Req() req: Request) { return this.service.createSite(await body(req, createSiteInput)); }

  @Get('sites/:siteId')
  @ApiOperation({ operationId: 'GET_api_v1_sites_siteId', summary: 'Read a site with retained records, sources and drafts' })
  @doc.ApiContract(200, doc.registryDetail)
  site(@Param('siteId') siteId: string) { return this.service.site(idSchema.parse(siteId)); }

  @Get('sites/:siteId/import-options')
  @ApiOperation({ operationId: 'GET_api_v1_sites_siteId_import_options', summary: 'List case import choices for the site' })
  @doc.ApiContract(200, { type: 'array', items: doc.caseRecord })
  importOptions(@Param('siteId') siteId: string) { return this.service.importOptions(idSchema.parse(siteId)); }

  @Post('sites/:siteId/workspace')
  @HttpCode(201)
  @ApiOperation({ operationId: 'POST_api_v1_sites_siteId_workspace', summary: 'Create a source preparation workspace for a site' })
  @doc.ApiContract(201, doc.idEnvelope)
  async workspace(@Param('siteId') siteId: string, @Req() req: Request) {
    await readBoundedBytes(req, 2 * 1024 * 1024);
    return this.service.workspace(idSchema.parse(siteId));
  }

  @Post('sites/:siteId/query')
  @HttpCode(200)
  @ApiOperation({ operationId: 'POST_api_v1_sites_siteId_query', summary: 'Find record intersections in the declared local frame' })
  @doc.ApiContract(200, doc.registryQuery, querySchema)
  async querySite(@Param('siteId') siteId: string, @Req() req: Request) {
    return this.service.query(idSchema.parse(siteId), await body(req, querySchema));
  }

  @Post('sites/:siteId/drafts')
  @HttpCode(201)
  @ApiOperation({ operationId: 'POST_api_v1_sites_siteId_drafts', summary: 'Create a revisioned registry draft' })
  @doc.ApiContract(201, doc.registryDraft, createDraftInput)
  async createDraft(@Param('siteId') siteId: string, @Req() req: Request) {
    return this.service.draft(idSchema.parse(siteId), await body(req, createDraftInput));
  }

  @Post('sites/:siteId/import')
  @HttpCode(201)
  @ApiOperation({ operationId: 'POST_api_v1_sites_siteId_import', summary: 'Import a current case into the selected site' })
  @doc.ApiContract(201, doc.draftIdEnvelope, importSiteInput)
  async importSite(@Param('siteId') siteId: string, @Req() req: Request) {
    const input = await body(req, importSiteInput);
    return this.service.importCase(idSchema.parse(siteId), input.caseId, input.expectedRevision);
  }

  @Get('resolve/:identifier')
  @ApiOperation({ operationId: 'GET_api_v1_resolve_identifier', summary: 'Resolve a saved site, record or legacy workspace identifier' })
  @doc.ApiContract(200, doc.resolver)
  resolve(@Param('identifier') identifier: string) { return this.service.resolve(identifier); }

  @Get('registry')
  @ApiOperation({ operationId: 'GET_api_v1_registry', summary: 'Search current registry records' })
  @ApiQuery({ name: 'q', required: false, schema: { type: 'string', maxLength: 150 } })
  @ApiQuery({ name: 'site', required: false, schema: { type: 'string', format: 'uuid' } })
  @doc.ApiContract(200, doc.registrySearch)
  search(@Req() req: Request) {
    const query = new URL(req.originalUrl ?? req.url, 'http://127.0.0.1').searchParams;
    const site = query.get('site');
    return this.service.search((query.get('q') ?? '').slice(0, 150), site ? idSchema.parse(site) : undefined);
  }

  @Get('registry/:identifier')
  @ApiOperation({ operationId: 'GET_api_v1_registry_identifier', summary: 'Read a current record and immutable revision history' })
  @doc.ApiContract(200, doc.registryResolution)
  record(@Param('identifier') identifier: string) { return this.service.record(identifier); }

  @Get('registry/:identifier/export')
  @ApiOperation({ operationId: 'GET_api_v1_registry_identifier_export', summary: 'Download record history and cited source metadata' })
  @doc.ApiExport(doc.registryRecordExport, [])
  async exportRecord(@Param('identifier') identifier: string, @Res() res: Response) {
    await sendWebResponse(res, await this.service.export(identifier));
  }

  @Get('registry-drafts/:draftId')
  @ApiOperation({ operationId: 'GET_api_v1_registry_drafts_draftId', summary: 'Read a registry draft' })
  @doc.ApiContract(200, doc.registryDraft)
  draft(@Param('draftId') draftId: string) { return this.service.draftDetail(idSchema.parse(draftId)); }

  @Patch('registry-drafts/:draftId')
  @ApiOperation({ operationId: 'PATCH_api_v1_registry_drafts_draftId', summary: 'Edit a registry draft at the expected revision' })
  @doc.ApiContract(200, doc.registryDraft, editDraftSchema)
  async editDraft(@Param('draftId') draftId: string, @Req() req: Request) {
    return this.service.editDraft(idSchema.parse(draftId), await body(req, editDraftSchema));
  }

  @Post('registry-drafts/:draftId/review')
  @HttpCode(200)
  @ApiOperation({ operationId: 'POST_api_v1_registry_drafts_draftId_review', summary: 'Prepare a pinned validation review' })
  @doc.ApiContract(200, doc.registryReview, reviewDraftInput)
  async review(@Param('draftId') draftId: string, @Req() req: Request) {
    const input = await body(req, reviewDraftInput);
    return this.service.review(idSchema.parse(draftId), input.expectedRevision, input.expectedSiteRevision);
  }

  @Post('registry-reviews/:reviewId/commit')
  @HttpCode(200)
  @ApiOperation({ operationId: 'POST_api_v1_registry_reviews_reviewId_commit', summary: 'Commit the pinned review transactionally' })
  @doc.ApiContract(200, doc.registryReview, commitReviewInput)
  async commit(@Param('reviewId') reviewId: string, @Req() req: Request) {
    const input = await body(req, commitReviewInput);
    return this.service.commit(idSchema.parse(reviewId), input.acknowledgement);
  }
}
