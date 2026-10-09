import { Controller, Get, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import { AppError } from '@ulpin/server/infrastructure/errors';
import { redactDocumentViews } from '@ulpin/server/modules/usp/ingest/redact';
import { AreaIntakeService } from '@ulpin/server/modules/areas/area-intake-service';
import { SourceBuildingImportSchema } from '@ulpin/contracts';
import { importSourceBuildings } from '@ulpin/server/modules/usp/ingestion/source-building-import';
import {
  acquisitionImportSchema, areaCheckSchema, areaIdSchema, areaImportMetadataSchema,
  areaMappingSchema, areaRevisionSchema, copyCaseDocumentsSchema, documentFormatSchema,
  packageAnswerSchema, packageCommitSchema, packageCorrectionSchema,
  packageFactSchema, packageRevisionSchema,
} from '@ulpin/server/modules/areas/area-validation';
import { JSON_BODY_LIMIT, MULTIPART_BODY_LIMIT, readJsonBody, readMultipartBody } from '../../common/body';
import {
  areaCheck, gisImportBody, gisInspection, importPackage, jsonBody, multipartBody, question,
  wireResponse,
} from './wire-schemas';

function fileFrom(form: FormData): File {
  const file = form.get('file');
  if (!(file instanceof File)) throw new AppError(400, 'MISSING_FILE', 'Choose a supporting file.');
  return file;
}
function structured(value: FormDataEntryValue | null, fallback?: unknown): unknown {
  try { return value === null ? fallback : JSON.parse(String(value)); }
  catch { throw new AppError(422, 'INVALID_INPUT', 'A structured form field is invalid.'); }
}
async function sourceBuildingInput(form: FormData) {
  const input = SourceBuildingImportSchema.parse(structured(form.get('metadata')));
  const files = [];
  for (const document of input.documents) {
    const file = form.get(document.key);
    if (!(file instanceof File)) throw new AppError(400, 'MISSING_FILE', 'Attach every cited document original.');
    files.push({ key: document.key, name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
  }
  return importSourceBuildings(input, files);
}

function formMetadata(form: FormData) {
  return areaImportMetadataSchema.parse({
    format: form.get('format'), layer: form.get('layer') || undefined,
    namespace: form.get('namespace'), name: form.get('name'),
    mapping: structured(form.get('mapping')),
    areaId: form.get('areaId') || undefined, sourceCrs: form.get('sourceCrs') || undefined,
    expectedAreaRevision: form.has('expectedAreaRevision') ? Number(form.get('expectedAreaRevision')) : undefined,
    worldStatus: form.get('worldStatus') || undefined,
  });
}

@ApiTags('intake-import-packages')
@Controller('api/v1')
export class ImportPackagesController {
  constructor(@Inject(AreaIntakeService) private readonly areas: AreaIntakeService) {}
  private async output<T>(result: Promise<T>): Promise<T> { return redactDocumentViews(await result); }

  @Post('import-packages/inspect')
  @HttpCode(200)
  @ApiOperation({operationId: 'POST_api_v1_import_packages_inspect', summary: 'Inspect bounded GIS source bytes without persistence'})
  @multipartBody(['file'], {layer: {type: 'string', minLength: 1, maxLength: 256}})
  @wireResponse(200, gisInspection)
  async inspect(@Req() request: Request) {
    const form = await readMultipartBody(request, MULTIPART_BODY_LIMIT);
    const file = fileFrom(form);
    return this.areas.inspect({name: file.name, bytes: new Uint8Array(await file.arrayBuffer())}, form.get('layer'));
  }

  @Post('import-packages')
  @HttpCode(201)
  @ApiOperation({operationId: 'POST_api_v1_import_packages', summary: 'Import a bounded GIS original, document-backed unknown-geometry buildings, or a retained acquisition'})
  @gisImportBody(acquisitionImportSchema, ['file', 'format', 'namespace', 'name', 'mapping'], {
    format: {type: 'string', enum: areaImportMetadataSchema.shape.format.options},
    layer: {type: 'string', maxLength: 256},
    namespace: {type: 'string', maxLength: 150}, name: {type: 'string', maxLength: 150},
    mapping: {type: 'string', description: 'JSON field validated by the canonical area mapping schema.', 'x-mappingSchema': z.toJSONSchema(areaMappingSchema, {target: 'openapi-3.0'})},
    areaId: {type: 'string', format: 'uuid'}, sourceCrs: {type: 'string', pattern: '^EPSG:[0-9]+$'},
    expectedAreaRevision: {type: 'integer', minimum: 0},
    worldStatus: {type: 'string', enum: ['observed', 'planned', 'hypothetical', 'synthetic']},
  }, SourceBuildingImportSchema)
  @wireResponse(201, importPackage)
  async create(@Req() request: Request) {
    if (request.headers['content-type']?.includes('multipart/form-data')) {
      const form = await readMultipartBody(request, MULTIPART_BODY_LIMIT);
      if (form.get('format') === 'document_buildings') return this.output(sourceBuildingInput(form));
      const file = fileFrom(form);
      const input = formMetadata(form);
      return this.output(this.areas.importGis({
        ...input, filename: file.name, bytes: new Uint8Array(await file.arrayBuffer()),
      }));
    }
    const input = acquisitionImportSchema.parse(await readJsonBody(request, JSON_BODY_LIMIT));
    return this.output(this.areas.importAcquisition(input));
  }

  @Get('import-packages/:packageId')
  @HttpCode(200)
  @ApiOperation({operationId: 'GET_api_v1_import_packages_packageId', summary: 'Read a retained import package'})
  @ApiParam({name: 'packageId', schema: {type: 'string', format: 'uuid'}})
  @wireResponse(200, importPackage)
  package(@Param('packageId') id: string) { return this.output(this.areas.package(areaIdSchema.parse(id))); }

  @Get('import-packages/:packageId/questions')
  @HttpCode(200)
  @ApiOperation({operationId: 'GET_api_v1_import_packages_packageId_questions', summary: 'Read evidence questions for one package'})
  @ApiParam({name: 'packageId', schema: {type: 'string', format: 'uuid'}})
  @wireResponse(200, z.array(question))
  questions(@Param('packageId') id: string) { return this.output(this.areas.questions(areaIdSchema.parse(id))); }

  @Post('import-packages/:packageId/correction')
  @HttpCode(201)
  @ApiOperation({operationId: 'POST_api_v1_import_packages_packageId_correction', summary: 'Create an idempotent correction package'})
  @jsonBody(packageCorrectionSchema)
  @wireResponse(201, importPackage)
  async correction(@Param('packageId') id: string, @Req() request: Request) {
    const {requestKey} = packageCorrectionSchema.parse(await readJsonBody(request, JSON_BODY_LIMIT));
    return this.output(this.areas.correct(areaIdSchema.parse(id), requestKey));
  }

  @Post('import-packages/:packageId/answers')
  @HttpCode(200)
  @ApiOperation({operationId: 'POST_api_v1_import_packages_packageId_answers', summary: 'Answer one evidence question at an expected package revision'})
  @jsonBody(packageAnswerSchema)
  @wireResponse(200, importPackage)
  async answer(@Param('packageId') id: string, @Req() request: Request) {
    return this.output(this.areas.answer(areaIdSchema.parse(id), packageAnswerSchema.parse(await readJsonBody(request, JSON_BODY_LIMIT))));
  }

  @Post('import-packages/:packageId/review')
  @HttpCode(200)
  @ApiOperation({operationId: 'POST_api_v1_import_packages_packageId_review', summary: 'Review package evidence and area conflicts'})
  @jsonBody(packageRevisionSchema)
  @wireResponse(200, importPackage)
  async review(@Param('packageId') id: string, @Req() request: Request) {
    const {expectedRevision} = packageRevisionSchema.parse(await readJsonBody(request, JSON_BODY_LIMIT));
    return this.output(this.areas.review(areaIdSchema.parse(id), expectedRevision));
  }

  @Post('import-packages/:packageId/prepare')
  @HttpCode(200)
  @ApiOperation({operationId: 'POST_api_v1_import_packages_packageId_prepare', summary: 'Prepare package review through the canonical review operation'})
  @jsonBody(packageRevisionSchema)
  @wireResponse(200, importPackage)
  async prepare(@Param('packageId') id: string, @Req() request: Request) {
    const {expectedRevision} = packageRevisionSchema.parse(await readJsonBody(request, JSON_BODY_LIMIT));
    return this.output(this.areas.review(areaIdSchema.parse(id), expectedRevision));
  }

  @Post('import-packages/:packageId/rebase')
  @HttpCode(200)
  @ApiOperation({operationId: 'POST_api_v1_import_packages_packageId_rebase', summary: 'Rebase package onto the current area revision'})
  @jsonBody(packageRevisionSchema)
  @wireResponse(200, importPackage)
  async rebase(@Param('packageId') id: string, @Req() request: Request) {
    const {expectedRevision} = packageRevisionSchema.parse(await readJsonBody(request, JSON_BODY_LIMIT));
    return this.output(this.areas.rebase(areaIdSchema.parse(id), expectedRevision));
  }

  @Post('import-packages/:packageId/commit')
  @HttpCode(200)
  @ApiOperation({operationId: 'POST_api_v1_import_packages_packageId_commit', summary: 'Commit reviewed source-supported package facts'})
  @jsonBody(packageCommitSchema)
  @wireResponse(200, importPackage)
  async commit(@Param('packageId') id: string, @Req() request: Request) {
    const input = packageCommitSchema.parse(await readJsonBody(request, JSON_BODY_LIMIT));
    return this.output(this.areas.commit(areaIdSchema.parse(id), input.expectedRevision, input.acknowledgement));
  }

  @Post('import-packages/:packageId/copy-case-documents')
  @HttpCode(200)
  @ApiOperation({operationId: 'POST_api_v1_import_packages_packageId_copy_case_documents', summary: 'Copy selected original-backed case document references'})
  @jsonBody(copyCaseDocumentsSchema)
  @wireResponse(200, importPackage)
  async copyDocuments(@Param('packageId') id: string, @Req() request: Request) {
    return this.output(this.areas.copyDocuments(areaIdSchema.parse(id), copyCaseDocumentsSchema.parse(await readJsonBody(request, JSON_BODY_LIMIT))));
  }

  private async attach(id: string, request: Request, sourceOnly: boolean) {
    const form = await readMultipartBody(request, MULTIPART_BODY_LIMIT);
    const file = fileFrom(form);
    const format = documentFormatSchema.parse(form.get('format'));
    return this.output(this.areas.document(
      areaIdSchema.parse(id), areaRevisionSchema.parse(Number(form.get('expectedRevision'))),
      {
        bytes: new Uint8Array(await file.arrayBuffer()), name: file.name, format,
        requestKey: sourceOnly && form.get('requestKey') ? areaIdSchema.parse(form.get('requestKey')) : undefined,
        familyId: form.get('familyId') ? areaIdSchema.parse(form.get('familyId')) : undefined,
        referenceOnly: form.get('referenceOnly') ? z.enum(['true']).parse(form.get('referenceOnly')) === 'true' : false,
        entityIds: sourceOnly ? [] : z.array(areaIdSchema).min(1).max(100).parse(structured(form.get('entityIds'))),
      },
      sourceOnly,
    ));
  }

  @Post('import-packages/:packageId/documents')
  @HttpCode(201)
  @ApiOperation({operationId: 'POST_api_v1_import_packages_packageId_documents', summary: 'Attach a document to selected physical entities'})
  @multipartBody(['file', 'format', 'expectedRevision', 'entityIds'], {
    format: {type: 'string', enum: documentFormatSchema.options},
    expectedRevision: {type: 'integer', minimum: 0}, entityIds: {type: 'string', description: 'JSON array of 1–100 entity UUIDs.'},
    familyId: {type: 'string', format: 'uuid'}, referenceOnly: {type: 'string', enum: ['true']},
  })
  @wireResponse(201, importPackage)
  documents(@Param('packageId') id: string, @Req() request: Request) { return this.attach(id, request, false); }

  @Post('import-packages/:packageId/source-documents')
  @HttpCode(201)
  @ApiOperation({operationId: 'POST_api_v1_import_packages_packageId_source_documents', summary: 'Attach an original to an explicit source-only workspace'})
  @multipartBody(['file', 'format', 'expectedRevision'], {
    format: {type: 'string', enum: documentFormatSchema.options},
    expectedRevision: {type: 'integer', minimum: 0},
    requestKey: {type: 'string', format: 'uuid'}, familyId: {type: 'string', format: 'uuid'},
    referenceOnly: {type: 'string', enum: ['true']},
  })
  @wireResponse(201, importPackage)
  sourceDocuments(@Param('packageId') id: string, @Req() request: Request) { return this.attach(id, request, true); }

  @Post('import-packages/:packageId/facts')
  @HttpCode(200)
  @ApiOperation({operationId: 'POST_api_v1_import_packages_packageId_facts', summary: 'Record an evidence-linked fact candidate'})
  @jsonBody(packageFactSchema)
  @wireResponse(200, importPackage)
  async fact(@Param('packageId') id: string, @Req() request: Request) {
    return this.output(this.areas.fact(areaIdSchema.parse(id), packageFactSchema.parse(await readJsonBody(request, JSON_BODY_LIMIT))));
  }

  @Post('area-checks')
  @HttpCode(201)
  @ApiOperation({operationId: 'POST_api_v1_area_checks', summary: 'Run an area check at the expected revision'})
  @jsonBody(areaCheckSchema)
  @wireResponse(201, areaCheck)
  async check(@Req() request: Request) {
    const input = areaCheckSchema.parse(await readJsonBody(request, JSON_BODY_LIMIT));
    return this.output(this.areas.check(input.areaId, input.expectedRevision));
  }

  @Get('area-checks/:checkId')
  @HttpCode(200)
  @ApiOperation({operationId: 'GET_api_v1_area_checks_checkId', summary: 'Read a retained area check'})
  @ApiParam({name: 'checkId', schema: {type: 'string', format: 'uuid'}})
  @wireResponse(200, areaCheck)
  checkResult(@Param('checkId') id: string) { return this.output(this.areas.checkResult(areaIdSchema.parse(id))); }
}
