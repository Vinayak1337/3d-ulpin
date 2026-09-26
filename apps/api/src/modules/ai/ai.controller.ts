import { Controller, Get, Post, Param, Req, HttpCode, UseGuards } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AppError } from '@ulpin/server/infrastructure/errors';
import {
  officerAiStatus, listOfficerAiRuns, getOfficerAiRun, createOfficerAiRun, applyOfficerAiRun,
  officerAiExtractSchema, officerAiApplySchema,
} from '@ulpin/server/modules/ai/officer-ai';
import { readMlJson } from '../spatial/ml-json';
import { PrivateSpatialGuard } from '../spatial/private-spatial.guard';
import { ApiResult, packageProjection, sourceLocator, uuid, requestWire as wire } from '../spatial/spatial.openapi';

const region = { type:'object',required:['x','y','width','height'],properties:{
  x:{type:'number'},y:{type:'number'},width:{type:'number'},height:{type:'number'},
} };
const aiStatus = {type:'object',required:['provider','configured','state','message','freeVerified','quota'],properties:{
  provider:{type:'string',enum:['nous','sarvam']},configured:{type:'boolean'},
  state:{type:'string',enum:['unconfigured','available','unavailable']},message:{type:'string'},
  model:{type:'string'},catalogCheckedAt:{type:'string',format:'date-time'},freeVerified:{type:'boolean'},
  capabilities:{type:'object',required:['image','structuredOutput'],properties:{image:{type:'boolean'},structuredOutput:{type:'boolean'}}},
  quota:{type:'object',required:['state'],properties:{state:{type:'string',enum:['unknown','reported']},remaining:{type:'string'},reset:{type:'string'}}},
}};
const candidate = {type:'object',required:['id','entityId','subject','property','value','evidence','evidenceState','worldStatus','method','citations','rationale'],properties:{
  id:{type:'string',format:'uuid'},entityId:{type:'string',format:'uuid'},subject:{type:'string'},property:{type:'string'},
  value:{description:'Grounded candidate value; type depends on canonical fact property'},
  unit:{type:'string'},referenceFrameId:{type:'string'},evidence:{type:'array',items:sourceLocator},
  evidenceState:{type:'string',enum:['unresolved','estimated','source_supported','reviewed']},
  worldStatus:{type:'string',enum:['observed','planned','hypothetical','synthetic']},method:{type:'string',enum:['ai_extraction']},
  citations:{type:'array',items:{type:'object',required:['partId','quote'],properties:{partId:{type:'string',format:'uuid'},quote:{type:'string'}}}},
  rationale:{type:'string'},
}};
const aiRun = {type:'object',required:['id','packageId','packageRevision','requestKey','state','provider','inputFingerprint','sourceHashes','partHashes','partIds','entityIds','promptVersion','schemaVersion','candidates','questions','validationErrors','calls','budget','startedAt'],properties:{
  id:{type:'string',format:'uuid'},packageId:{type:'string',format:'uuid'},packageRevision:{type:'integer'},
  requestKey:{type:'string',format:'uuid'},state:{type:'string',enum:['blocked','running','succeeded','needs_input','failed','stale','applied']},
  provider:{type:'string',enum:['nous','sarvam']},model:{type:'string'},inputFingerprint:{type:'string'},
  gatewayPolicyHash:{type:'string'},principalHash:{type:'string'},
  sourceHashes:{type:'array',items:{type:'object',required:['sourceRevisionId','sha256'],properties:{
    sourceRevisionId:{type:'string',format:'uuid'},sha256:{type:'string',pattern:'^[a-f0-9]{64}$'}}}},
  partHashes:{type:'array',items:{type:'object',required:['partId','sha256'],properties:{
    partId:{type:'string',format:'uuid'},sha256:{type:'string',pattern:'^[a-f0-9]{64}$'}}}},
  imageRegions:{type:'array',items:{type:'object',required:['partId','region'],properties:{partId:{type:'string',format:'uuid'},region}}},
  derivatives:{type:'array',items:{type:'object',required:['partId','sourceSha256','sha256','width','height','region','method'],properties:{
    partId:{type:'string',format:'uuid'},sourceSha256:{type:'string'},sha256:{type:'string'},width:{type:'integer'},height:{type:'integer'},
    region,sourcePixels:{type:'array',items:{type:'number'}},pixelRegion:{type:'array',items:{type:'number'}},
    orientation:{type:'string'},method:{type:'string'}}}},
  partIds:{type:'array',items:{type:'string',format:'uuid'}},entityIds:{type:'array',items:{type:'string',format:'uuid'}},
  promptVersion:{type:'string'},schemaVersion:{type:'string'},candidates:{type:'array',items:candidate},
  questions:{type:'array',items:{type:'string'}},
  suggestions:{type:'array',items:{type:'object',required:['id','kind','partId','sourceRevisionId','locator','quote','rationale','evidenceState'],
    properties:{id:{type:'string'},kind:{type:'string',enum:['source_role','entity_association']},partId:{type:'string',format:'uuid'},
      sourceRevisionId:{type:'string',format:'uuid'},locator:{type:'string'},role:{type:'string'},entityId:{type:'string',format:'uuid'},
      matchedIdentifier:{type:'string'},quote:{type:'string'},rationale:{type:'string'},evidenceState:{type:'string',enum:['unresolved']},imageRegion:region}}},
  answers:{type:'array',items:{type:'object',required:['question','answer'],properties:{question:{type:'string'},answer:{type:'string'}}}},
  validationErrors:{type:'array',items:{type:'string'}},message:{type:'string'},cached:{type:'boolean'},
  cachedFromRunId:{type:'string',format:'uuid'},
  calls:{type:'array',items:{type:'object',required:['latencyMs'],properties:{latencyMs:{type:'number'},inputTokens:{type:'integer'},
    outputTokens:{type:'integer'},responseId:{type:'string'},httpStatus:{type:'integer'},outputHash:{type:'string'},
    callId:{type:'string',format:'uuid'},actualMicroInr:{type:'string',pattern:'^(0|[1-9][0-9]*)$'},priceVersion:{type:'string'},
    semanticError:{type:'string',enum:['invalid_output','truncated_output']}}}},
  budget:{type:'object',required:['maxCalls','maxOutputTokens','timeoutMs'],properties:{
    maxCalls:{type:'integer'},maxOutputTokens:{type:'integer'},timeoutMs:{type:'integer'}}},
  startedAt:{type:'string',format:'date-time'},completedAt:{type:'string',format:'date-time'},
  appliedRevision:{type:'integer'},appliedCandidateIds:{type:'array',items:{type:'string',format:'uuid'}},
}};
const packageIdParam = { name: 'packageId', schema: { type: 'string', format: 'uuid' } };
const runIdParam = { name: 'runId', schema: { type: 'string', format: 'uuid' } };

@ApiTags('officer AI')
@UseGuards(PrivateSpatialGuard)
@Controller('api/v1/ai')
export class AiStatusController {
  @Get('status')
  @HttpCode(200)
  @ApiOperation({ operationId: 'GET_api_v1_ai_status', summary: 'Read private provider configuration and bounded entitlement status' })
  @ApiResult(200, aiStatus, [403, 503])
  status() { return officerAiStatus(); }
}

@ApiTags('officer AI')
@UseGuards(PrivateSpatialGuard)
@Controller('api/v1/import-packages/:packageId/ai-extractions')
export class OfficerAiController {
  @Get()
  @HttpCode(200)
  @ApiOperation({ operationId: 'GET_api_v1_import_packages_packageId_ai_extractions', summary: 'List retained extraction runs for one preparation' })
  @ApiParam(packageIdParam)
  @ApiResult(200, {type:'array',items:aiRun})
  list(@Param('packageId') rawId: string) { return listOfficerAiRuns(uuid.parse(rawId)); }

  @Post()
  @HttpCode(200)
  @ApiOperation({ operationId: 'POST_api_v1_import_packages_packageId_ai_extractions', summary: 'Extract grounded draft candidates from exact retained evidence' })
  @ApiParam(packageIdParam)
  @ApiBody({ schema: wire(officerAiExtractSchema) as never })
  @ApiResult(200, aiRun, [400, 403, 404, 409, 413, 422, 503])
  async create(@Param('packageId') rawId: string, @Req() request: Request) {
    const value = officerAiExtractSchema.parse(await readMlJson(request, 100_000));
    return createOfficerAiRun(uuid.parse(rawId), value);
  }

  @Get(':runId')
  @HttpCode(200)
  @ApiOperation({ operationId: 'GET_api_v1_import_packages_packageId_ai_extractions_runId', summary: 'Read one retained extraction and its candidate facts' })
  @ApiParam(packageIdParam)
  @ApiParam(runIdParam)
  @ApiResult(200, aiRun)
  get(@Param('packageId') rawPackageId: string, @Param('runId') rawRunId: string) {
    return getOfficerAiRun(uuid.parse(rawPackageId), uuid.parse(rawRunId));
  }

  @Get(':runId/derivatives/:asset')
  @HttpCode(403)
  @ApiOperation({ operationId: 'GET_api_v1_import_packages_packageId_ai_extractions_runId_derivatives_asset', summary: 'Retained crop previews unavailable pending visual privacy qualification' })
  @ApiParam(packageIdParam)
  @ApiParam(runIdParam)
  @ApiParam({ name: 'asset', schema: { type: 'string' } })
  @ApiResult(403, {type:'object',required:['error'],properties:{error:{type:'object',required:['code','message','requestId'],properties:{
    code:{type:'string',enum:['AI_IMAGE_PRIVACY','CROSS_ORIGIN_READ','HOST_DENIED','ORIGIN_DENIED']},message:{type:'string'},requestId:{type:'string',format:'uuid'}}}}}, [422])
  derivative(@Param('packageId') rawPackageId: string): never {
    uuid.parse(rawPackageId);
    throw new AppError(403, 'AI_IMAGE_PRIVACY', 'Crop previews are unavailable pending visual redaction qualification. Inspect the retained original locally.');
  }

  @Post(':runId/apply')
  @HttpCode(200)
  @ApiOperation({ operationId: 'POST_api_v1_import_packages_packageId_ai_extractions_runId_apply', summary: 'Add selected grounded candidates as draft preparation facts' })
  @ApiParam(packageIdParam)
  @ApiParam(runIdParam)
  @ApiBody({ schema: wire(officerAiApplySchema) as never })
  @ApiResult(200, packageProjection, [400, 403, 404, 409, 413, 422, 503])
  async apply(@Param('packageId') rawPackageId: string, @Param('runId') rawRunId: string, @Req() request: Request) {
    const value = officerAiApplySchema.parse(await readMlJson(request, 20_000));
    return applyOfficerAiRun(uuid.parse(rawPackageId), uuid.parse(rawRunId), value);
  }
}
