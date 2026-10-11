import { Controller, Get, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { IntakeConfirmSchema, IntakeConfirmationSchema, IntakeRunControlSchema,
  IntakeTargetPageSchema, IntakeTargetQuerySchema, IntakeTargetReadinessSchema,
  IntakeTargetSchema } from '@ulpin/contracts/usp';
import { confirmIntake, readIntakeConfirmation, retryIntakeConfirmation }
  from '@ulpin/server/modules/usp/ingestion/intake-confirmations';
import { listIntakeTargets, prioritizeIntakeTarget } from '@ulpin/server/modules/usp/ingestion/intake-targets';
import { AppError } from '@ulpin/server/infrastructure/errors';
import { readJsonBody } from '../../common/body';
import { jsonBody, wireResponse } from '../intake/wire-schemas';
import { PrivateSpatialGuard } from '../spatial/private-spatial.guard';

const bodyLimit = 32 * 1024;
const param = (name: string) => ApiParam({ name, schema: { type: 'string', format: 'uuid' } });

export function intakeTargetQuery(originalUrl: string) {
  const params = new URL(originalUrl, 'http://127.0.0.1').searchParams;
  for (const key of params.keys()) {
    if (!['readiness', 'cursor'].includes(key) || params.getAll(key).length !== 1) {
      throw new AppError(422, 'INTAKE_TARGET_QUERY',
        'Use one optional readiness and cursor, and no other query fields.');
    }
  }
  return IntakeTargetQuerySchema.parse(Object.fromEntries(params));
}

@ApiTags('private intake run')
@UseGuards(PrivateSpatialGuard)
@Controller('api/v1/ingestion')
export class IntakeRunController {
  @Get('cases/:caseId/targets')
  @param('caseId')
  @ApiQuery({ name: 'readiness', required: false, enum: IntakeTargetReadinessSchema.options })
  @ApiQuery({ name: 'cursor', required: false, schema: { type: 'string', format: 'uuid' } })
  @ApiOperation({ operationId: 'GET_api_v1_ingestion_cases_caseId_targets',
    summary: 'Read a bounded target page and grouped readiness counts for the retained batch' })
  @wireResponse(200, IntakeTargetPageSchema)
  targets(@Param('caseId') caseId: string, @Req() request: Request) {
    const query = intakeTargetQuery(request.originalUrl);
    return listIntakeTargets(caseId, query.readiness, query.cursor);
  }

  @Post('cases/:caseId/confirmations')
  @HttpCode(202) @param('caseId')
  @ApiOperation({ operationId: 'POST_api_v1_ingestion_cases_caseId_confirmations',
    summary: 'Store one officer confirmation of exact reviewed packages and at most 100 ready targets, then enqueue' })
  @jsonBody(IntakeConfirmSchema) @wireResponse(202, IntakeConfirmationSchema)
  async confirm(@Param('caseId') caseId: string, @Req() request: Request) {
    return confirmIntake(caseId, await readJsonBody(request, bodyLimit));
  }

  @Get('cases/:caseId/confirmations/:confirmationId')
  @param('caseId') @param('confirmationId')
  @ApiOperation({ operationId: 'GET_api_v1_ingestion_cases_caseId_confirmations_confirmationId',
    summary: 'Read the stored confirmation, listed target stages and artefacts, and recorded/carded/stopped counts' })
  @wireResponse(200, IntakeConfirmationSchema)
  confirmation(@Param('caseId') caseId: string, @Param('confirmationId') confirmationId: string) {
    return readIntakeConfirmation(caseId, confirmationId);
  }

  @Post('cases/:caseId/confirmations/:confirmationId/retry')
  @HttpCode(202) @param('caseId') @param('confirmationId')
  @ApiOperation({ operationId: 'POST_api_v1_ingestion_cases_caseId_confirmations_confirmationId_retry',
    summary: 'Re-enqueue stopped listed targets before expiry, preserving every completed step and command key' })
  @jsonBody(IntakeRunControlSchema) @wireResponse(202, IntakeConfirmationSchema)
  async retry(@Param('caseId') caseId: string, @Param('confirmationId') confirmationId: string,
    @Req() request: Request) {
    IntakeRunControlSchema.parse(await readJsonBody(request, bodyLimit));
    return retryIntakeConfirmation(caseId, confirmationId);
  }

  @Post('cases/:caseId/targets/:targetId/priority')
  @HttpCode(200) @param('caseId') @param('targetId')
  @ApiOperation({ operationId: 'POST_api_v1_ingestion_cases_caseId_targets_targetId_priority',
    summary: 'Take a confirmed or recorded target opened by the officer before other waiting intake-run targets' })
  @jsonBody(IntakeRunControlSchema) @wireResponse(200, IntakeTargetSchema)
  async priority(@Param('caseId') caseId: string, @Param('targetId') targetId: string, @Req() request: Request) {
    IntakeRunControlSchema.parse(await readJsonBody(request, bodyLimit));
    return prioritizeIntakeTarget(caseId, targetId);
  }
}
