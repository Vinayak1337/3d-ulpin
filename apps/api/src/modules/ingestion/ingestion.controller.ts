import { Controller, Get, HttpCode, Inject, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { AnyAuthorMappingSchema, MappingDecisionSchema,
  AnyMappingReceiptSchema, AnySourceProfileSchema, StreamedMappingReceiptSchema, TableFromOriginalSchema,
  TableProfileJobSchema, TableRowsPageSchema, TABULAR_STREAM_LIMITS } from '@ulpin/contracts/usp';
import { TableRowsService } from '@ulpin/server/modules/usp/ingestion/table-windows';
import { ManualIngestionService } from '@ulpin/server/modules/usp/ingestion/service';
import { IntakeService } from '@ulpin/server/modules/usp/ingestion/intake-service';
import { IntakeRegisterSchema, IntakePinSchema, IntakeItemSchema, IntakeManifestSchema, IntakeLargeRetrySchema,
  IntakeLargeRetryResultSchema, IntakeArchiveReceiptSchema, IntakePageImageAnswerSchema,
  IntakeLayerCrsSchema } from '@ulpin/contracts/usp';
import { IntakeSurfacePartPageSchema, IntakeSurfacePartsQuerySchema,
  IntakeSurfaceDisplaySchema } from '@ulpin/contracts/usp';
import { IntakeEvidenceOutcomeSchema, IntakeEvidencePageSchema, IntakeEvidenceQuerySchema,
  IntakeKeyProfileInputSchema, IntakeKeyProfileSchema } from '@ulpin/contracts/usp';
import { IntakeArchiveService } from '@ulpin/server/modules/usp/ingestion/intake-zip-layers';
import { declareIntakeKeyProfile, readIntakeEvidence } from '@ulpin/server/modules/usp/ingestion/intake-evidence';
import { retryIntakeLargeItem } from '@ulpin/server/modules/usp/ingestion/intake-large';
import { CONVERSIONS, limitations } from '@ulpin/server/modules/usp/ingestion/registry';
import { AppError } from '@ulpin/server/infrastructure/errors';
import { JSON_BODY_LIMIT, MULTIPART_BODY_LIMIT, readJsonBody, readMultipartBody } from '../../common/body';
import { binary, jsonBody, multipartBody, wireResponse } from '../intake/wire-schemas';
import { PrivateSpatialGuard } from '../spatial/private-spatial.guard';
import { strictQuery } from './intake-run.controller';

const param = (name: string) => ApiParam({name,schema:{type:'string',format:'uuid'}});
const registrySchema=z.object({version:z.literal('manual-geojson/1'),conversions:z.array(z.object({id:z.string(),target:z.string(),inputUnit:z.string(),outputUnit:z.string(),semantics:z.string()})),limitations:z.array(z.string())});

@ApiTags('manual ingestion')
@UseGuards(PrivateSpatialGuard)
@Controller('api/v1/ingestion')
export class IngestionController {
  constructor(@Inject(ManualIngestionService) private readonly ingestion: ManualIngestionService) {}

  private readonly intake = new IntakeService();
  private readonly archives = new IntakeArchiveService();
  private readonly tableRows = new TableRowsService();

  @Post('cases/:caseId/intake/items')
  @HttpCode(201) @param('caseId')
  @ApiOperation({operationId:'POST_api_v1_ingestion_cases_caseId_intake_items',
    summary:'Register and header-probe an already retained source; no reader or case revision change'})
  @jsonBody(IntakeRegisterSchema) @wireResponse(201,IntakeItemSchema)
  async registerIntake(@Param('caseId') caseId:string,@Req() request:Request){
    return this.intake.register(caseId,await readJsonBody(request,JSON_BODY_LIMIT));
  }

  @Post('cases/:caseId/intake/archives')
  @HttpCode(201) @param('caseId')
  @ApiOperation({operationId:'POST_api_v1_ingestion_cases_caseId_intake_archives',
    summary:'Retain a ZIP of map layers (at most 16 MiB) unchanged for a batch; enrolling it keeps each GeoJSON member as its own original'})
  @multipartBody(['file','requestKey','expectedWorkspaceRevision'],{
    requestKey:{type:'string',format:'uuid'},expectedWorkspaceRevision:{type:'integer',minimum:0},
  })
  @wireResponse(201,IntakeArchiveReceiptSchema)
  async retainArchive(@Param('caseId') caseId:string,@Req() request:Request){
    const form=await readMultipartBody(request,MULTIPART_BODY_LIMIT),file=form.get('file');
    if(!(file instanceof File))throw new AppError(400,'MISSING_FILE','Choose a ZIP original.');
    const allowed=new Set(['file','requestKey','expectedWorkspaceRevision']);
    for(const key of form.keys())if(!allowed.has(key)||form.getAll(key).length!==1)throw new AppError(422,'INVALID_INPUT','Use one value for each allowed receipt field.');
    return this.archives.retain(caseId,{requestKey:form.get('requestKey'),
      expectedWorkspaceRevision:form.has('expectedWorkspaceRevision')?Number(form.get('expectedWorkspaceRevision')):undefined,
    },{name:file.name,bytes:new Uint8Array(await file.arrayBuffer())});
  }

  @Get('cases/:caseId/intake')
  @param('caseId')
  @ApiOperation({operationId:'GET_api_v1_ingestion_cases_caseId_intake',
    summary:'Read the retained batch holdings manifest ordered by wave and name'})
  @wireResponse(200,IntakeManifestSchema)
  intakeManifest(@Param('caseId') caseId:string){return this.intake.manifest(caseId);}

  @Get('cases/:caseId/intake/items/:itemId')
  @param('caseId') @param('itemId')
  @ApiOperation({operationId:'GET_api_v1_ingestion_cases_caseId_intake_items_itemId',
    summary:'Read one holdings card under its original source authority'})
  @wireResponse(200,IntakeItemSchema)
  intakeItem(@Param('caseId') caseId:string,@Param('itemId') itemId:string){return this.intake.one(caseId,itemId);}

  @Get('cases/:caseId/intake/items/:itemId/parts')
  @param('caseId') @param('itemId') @ApiQuery({name:'after',required:false,schema:{type:'integer',minimum:-1}})
  @ApiOperation({operationId:'GET_api_v1_ingestion_cases_caseId_intake_items_itemId_parts',
    summary:'Read the parts of a kept orthophoto, terrain raster or point cloud in order, a page at a time'})
  @wireResponse(200,IntakeSurfacePartPageSchema)
  intakeParts(@Param('caseId') caseId:string,@Param('itemId') itemId:string,@Req() request:Request){
    return this.intake.parts(caseId,itemId,strictQuery(request.originalUrl,IntakeSurfacePartsQuerySchema,['after'],
      'INTAKE_PARTS_QUERY','Use one optional after, and no other query fields.'));
  }

  @Get('cases/:caseId/intake/items/:itemId/parts/:partIndex/display')
  @param('caseId') @param('itemId') @ApiParam({name:'partIndex',schema:{type:'integer',minimum:0}})
  @ApiOperation({operationId:'GET_api_v1_ingestion_cases_caseId_intake_items_itemId_parts_partIndex_display',
    summary:'Read the corners of one accepted part in the batch frame and its private artifact; display only'})
  @wireResponse(200,IntakeSurfaceDisplaySchema)
  intakePartDisplay(@Param('caseId') caseId:string,@Param('itemId') itemId:string,
    @Param('partIndex') partIndex:string){
    return this.intake.display(caseId,itemId,partIndex);
  }

  @Post('cases/:caseId/intake/items/:itemId/pin')
  @HttpCode(200) @param('caseId') @param('itemId')
  @ApiOperation({operationId:'POST_api_v1_ingestion_cases_caseId_intake_items_itemId_pin',
    summary:'Pin an intake item to an officer-selected wave, kept across later probes'})
  @jsonBody(IntakePinSchema) @wireResponse(200,IntakeItemSchema)
  async pinIntake(@Param('caseId') caseId:string,@Param('itemId') itemId:string,@Req() request:Request){
    return this.intake.pin(caseId,itemId,await readJsonBody(request,JSON_BODY_LIMIT));
  }

  @Post('cases/:caseId/intake/items/:itemId/page-image-label')
  @HttpCode(200) @param('caseId') @param('itemId')
  @ApiOperation({operationId:'POST_api_v1_ingestion_cases_caseId_intake_items_itemId_page_image_label',
    summary:'Say what a read page image shows (plan, elevation, photo, other); kept as an unreviewed candidate label'})
  @jsonBody(IntakePageImageAnswerSchema) @wireResponse(200,IntakeItemSchema)
  async labelPageImage(@Param('caseId') caseId:string,@Param('itemId') itemId:string,@Req() request:Request){
    return this.intake.labelPageImage(caseId,itemId,await readJsonBody(request,JSON_BODY_LIMIT));
  }

  @Get('cases/:caseId/intake/items/:itemId/page-image-preview')
  @param('caseId') @param('itemId')
  @ApiOperation({operationId:'GET_api_v1_ingestion_cases_caseId_intake_items_itemId_page_image_preview',
    summary:'Read the stored PNG preview of a read page image; its bytes are checked against the kept SHA-256'})
  @ApiResponse({status:200,content:{'image/png':{schema:binary}}})
  @ApiResponse({status:404,description:'The item is not in this case, or it has no page image preview'})
  @ApiResponse({status:409,description:'The stored preview differs from the SHA-256 kept on the item'})
  async pageImagePreview(@Param('caseId') caseId:string,@Param('itemId') itemId:string,@Res() response:Response){
    const preview=await this.intake.pageImagePreview(caseId,itemId);
    response.set({'Content-Type':'image/png','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff',
      'Content-Length':String(preview.bytes.length),'X-Content-SHA256':preview.sha256});
    response.send(Buffer.from(preview.bytes));
  }

  @Post('cases/:caseId/intake/items/:itemId/retry')
  @HttpCode(200) @param('caseId') @param('itemId')
  @ApiOperation({operationId:'POST_api_v1_ingestion_cases_caseId_intake_items_itemId_retry',
    summary:'Try a large file again after its preparation stopped on repeated step errors; one stored request'})
  @jsonBody(IntakeLargeRetrySchema) @wireResponse(200,IntakeLargeRetryResultSchema)
  async retryIntake(@Param('caseId') caseId:string,@Param('itemId') itemId:string,@Req() request:Request){
    return retryIntakeLargeItem(caseId,itemId,await readJsonBody(request,JSON_BODY_LIMIT));
  }

  @Post('cases/:caseId/intake/items/:itemId/layer-crs')
  @HttpCode(200) @param('caseId') @param('itemId')
  @ApiOperation({operationId:'POST_api_v1_ingestion_cases_caseId_intake_items_itemId_layer_crs',
    summary:'State the EPSG code of a GeoPackage or shapefile layer whose file states none, and convert it again'})
  @jsonBody(IntakeLayerCrsSchema) @wireResponse(200,IntakeItemSchema)
  async layerCrs(@Param('caseId') caseId:string,@Param('itemId') itemId:string,@Req() request:Request){
    return this.intake.layerCrs(caseId,itemId,await readJsonBody(request,JSON_BODY_LIMIT));
  }

  @Get('conversions')
  @ApiOperation({operationId:'GET_api_v1_ingestion_conversions',summary:'Read the constrained manual conversion registry and supported evidence requirements'})
  @wireResponse(200,registrySchema)
  conversions(){return {version:'manual-geojson/1',conversions:CONVERSIONS,limitations};}

  @Post('cases/:caseId/sources')
  @HttpCode(201)
  @param('caseId')
  @ApiOperation({operationId:'POST_api_v1_ingestion_cases_caseId_sources',
    summary:'Retain a pinned GeoJSON or public D8 CSV/XLSX original in an existing source case'})
  @multipartBody(['file','format','requestKey','expectedWorkspaceRevision'],{
    format:{type:'string',enum:['geojson','csv','xlsx']},
    selection:{type:'string',description:'JSON tabular selection: format, sheet, table:null, ordered headerRows'},
    requestKey:{type:'string',format:'uuid'},expectedWorkspaceRevision:{type:'integer',minimum:0},
    familyId:{type:'string',format:'uuid'},expectedSourceRevision:{type:'integer',minimum:1},
    issuer:{type:'string',minLength:1,maxLength:500},
    licence:{type:'string',enum:['unconfirmed','open','restricted']},
    containsPersonalData:{type:'string',enum:['unknown','yes','no']},
  })
  @wireResponse(201,AnySourceProfileSchema)
  async retain(@Param('caseId') caseId:string,@Req() request:Request){
    const form=await readMultipartBody(request,MULTIPART_BODY_LIMIT),file=form.get('file');
    if(!(file instanceof File))throw new AppError(400,'MISSING_FILE','Choose an original for the selected format.');
    const allowed=new Set(['file','format','selection','requestKey','expectedWorkspaceRevision',
      'familyId','expectedSourceRevision','issuer','licence','containsPersonalData']);
    for(const key of form.keys())if(!allowed.has(key)||form.getAll(key).length!==1)throw new AppError(422,'INVALID_INPUT','Use one value for each allowed receipt field.');
    let selection:unknown;
    if(form.has('selection')){
      try{selection=JSON.parse(String(form.get('selection')));}
      catch{throw new AppError(422,'INVALID_INPUT','Selection must be one JSON object.');}
    }
    return this.ingestion.retain(caseId,{...(selection!==undefined?{selection}:{}),
      ...(form.has('issuer')?{issuer:form.get('issuer')}:{}),
      ...(form.has('licence')?{licence:form.get('licence')}:{}),
      ...(form.has('containsPersonalData')?{containsPersonalData:form.get('containsPersonalData')}:{}),
      format:form.get('format'),requestKey:form.get('requestKey'),
      expectedWorkspaceRevision:form.has('expectedWorkspaceRevision')?Number(form.get('expectedWorkspaceRevision')):undefined,
      ...(form.has('familyId')?{familyId:form.get('familyId')}:{}),...(form.has('expectedSourceRevision')?{expectedSourceRevision:Number(form.get('expectedSourceRevision'))}:{}),
    },{name:file.name,bytes:new Uint8Array(await file.arrayBuffer())});
  }
  @Get('cases/:caseId/sources/:sourceId/profile')
  @param('caseId') @param('sourceId')
  @ApiOperation({operationId:'GET_api_v1_ingestion_cases_caseId_sources_sourceId_profile',summary:'Read current field paths and source/workspace pins for a retained original'})
  @wireResponse(200,AnySourceProfileSchema)
  inspect(@Param('caseId') caseId:string,@Param('sourceId') sourceId:string){
    return this.ingestion.inspectAny(caseId,sourceId);
  }

  @Post('cases/:caseId/sources/:sourceId/table')
  @HttpCode(202) @param('caseId') @param('sourceId')
  @ApiOperation({operationId:'POST_api_v1_ingestion_cases_caseId_sources_sourceId_table',
    summary:'Make a kept original a table source: up to 16 MiB it is read here (201); a larger CSV, or one sheet of a '+
      'larger workbook, is read as a stream by a queued job (202), and a replay answers that job as it stands; '+
      'its bytes stay unchanged'})
  @jsonBody(TableFromOriginalSchema) @wireResponse(202,TableProfileJobSchema)
  @ApiResponse({status:201,schema:z.toJSONSchema(AnySourceProfileSchema,{target:'openapi-3.0'}) as never})
  async tableFromOriginal(@Param('caseId') caseId:string,@Param('sourceId') sourceId:string,@Req() request:Request,
    @Res({passthrough:true}) response:Response){
    const result=await this.ingestion.tableFromOriginal(caseId,sourceId,await readJsonBody(request,JSON_BODY_LIMIT));
    if(result.version!=='table-profile/1')response.status(201);
    return result;
  }

  @Get('cases/:caseId/sources/:sourceId/rows')
  @param('caseId') @param('sourceId')
  @ApiOperation({operationId:'GET_api_v1_ingestion_cases_caseId_sources_sourceId_rows',
    summary:'One page of a streamed table by record number, each row with its locator and any mapped cells'})
  @ApiQuery({name:'after',required:false,schema:{type:'integer',minimum:-1,maximum:TABULAR_STREAM_LIMITS.rows - 1}})
  @ApiQuery({name:'limit',required:false,schema:{type:'integer',minimum:1,maximum:TABULAR_STREAM_LIMITS.pageRows}})
  @wireResponse(200,TableRowsPageSchema)
  rows(@Param('caseId') caseId:string,@Param('sourceId') sourceId:string,
    @Query('after') after?:string,@Query('limit') limit?:string){
    return this.tableRows.page(caseId,sourceId,{...(after===undefined?{}:{after}),...(limit===undefined?{}:{limit})});
  }

  @Post('cases/:caseId/sources/:sourceId/recipes')
  @HttpCode(201) @param('caseId') @param('sourceId')
  @ApiOperation({operationId:'POST_api_v1_ingestion_cases_caseId_sources_sourceId_recipes',summary:'Author or revise a constrained manual recipe as proposed; prior decisions remain retained'})
  @jsonBody(AnyAuthorMappingSchema) @wireResponse(201,AnyMappingReceiptSchema)
  async author(@Param('caseId') caseId:string,@Param('sourceId') sourceId:string,@Req() request:Request){return this.ingestion.author(caseId,sourceId,await readJsonBody(request,JSON_BODY_LIMIT));}

  @Get('cases/:caseId/recipes/:recipeId')
  @param('caseId') @param('recipeId')
  @ApiOperation({operationId:'GET_api_v1_ingestion_cases_caseId_recipes_recipeId',summary:'Read the retained recipe and decision revision history'})
  // A large file's streamed author and approve write their revisions to the same history.
  @wireResponse(200,z.array(z.union([...AnyMappingReceiptSchema.options,StreamedMappingReceiptSchema])))
  history(@Param('caseId') caseId:string,@Param('recipeId') recipeId:string){return this.ingestion.read(caseId,recipeId);}

  @Post('cases/:caseId/recipes/:recipeId/approve')
  @HttpCode(200) @param('caseId') @param('recipeId')
  @ApiOperation({operationId:'POST_api_v1_ingestion_cases_caseId_recipes_recipeId_approve',summary:'Explicitly approve the current pinned manual recipe using the configured local operator'})
  @jsonBody(MappingDecisionSchema) @wireResponse(200,AnyMappingReceiptSchema)
  async approve(@Param('caseId') caseId:string,@Param('recipeId') recipeId:string,@Req() request:Request){return this.ingestion.decide(caseId,recipeId,await readJsonBody(request,JSON_BODY_LIMIT),'approve');}

  @Post('cases/:caseId/recipes/:recipeId/execute')
  @HttpCode(200) @param('caseId') @param('recipeId')
  @ApiOperation({operationId:'POST_api_v1_ingestion_cases_caseId_recipes_recipeId_execute',summary:'Execute one approved current recipe through the existing synchronous GIS package authority'})
  @jsonBody(MappingDecisionSchema) @wireResponse(200,AnyMappingReceiptSchema)
  async execute(@Param('caseId') caseId:string,@Param('recipeId') recipeId:string,@Req() request:Request){return this.ingestion.decide(caseId,recipeId,await readJsonBody(request,JSON_BODY_LIMIT),'execute');}

  @Get('cases/:caseId/intake/evidence')
  @param('caseId')
  @ApiQuery({name:'outcome',required:false,enum:IntakeEvidenceOutcomeSchema.options})
  @ApiQuery({name:'cursor',required:false,schema:{type:'string',format:'uuid'}})
  @ApiOperation({operationId:'GET_api_v1_ingestion_cases_caseId_intake_evidence',
    summary:'Read exact-key profiles, source coverage, stored evidence confirmations and a page of candidate '
      +'table rows and document parts for the batch, with counts by outcome'})
  @wireResponse(200,IntakeEvidencePageSchema)
  intakeEvidence(@Param('caseId') caseId:string,@Req() request:Request){
    const query=strictQuery(request.originalUrl,IntakeEvidenceQuerySchema,['outcome','cursor'],'INTAKE_EVIDENCE_QUERY',
      'Use one optional outcome and cursor, and no other query fields.');
    return readIntakeEvidence(caseId,query);
  }

  @Post('cases/:caseId/intake/evidence/key-profiles')
  @HttpCode(201) @param('caseId')
  @ApiOperation({operationId:'POST_api_v1_ingestion_cases_caseId_intake_evidence_key_profiles',
    summary:'Declare which map field and table columns or documents carry one exact literal key, and queue '
      +'every named source to be read under it'})
  @jsonBody(IntakeKeyProfileInputSchema) @wireResponse(201,IntakeKeyProfileSchema)
  async keyProfile(@Param('caseId') caseId:string,@Req() request:Request){
    return declareIntakeKeyProfile(caseId,await readJsonBody(request,JSON_BODY_LIMIT));
  }
}
