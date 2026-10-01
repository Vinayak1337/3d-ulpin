import { Controller, HttpCode, Post, Req, Res, UseFilters, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { UspCreatePacketPlanSchema, UspRevisePacketPlanSchema, UspReadPacketPlanSchema,
  UspConfirmPacketPlanSchema, UspExecutePacketPlanSchema, UspPacketPlanSchema,
  UspPacketPlanViewSchema, UspPacketPlanConfirmationSchema, UspPacketPlanExecutionSchema,
} from '../../../../../packages/contracts/src/usp/packets';
import { createPacketPlan, revisePacketPlan, readPacketPlan, confirmPacketPlan,
  executePacketPlan } from '@ulpin/server/modules/usp/packets/plan-service';
import { localRequestContext } from '@ulpin/server/modules/usp/principal';
import { requestId } from '../../common/request-context';
import { PrivateSpatialGuard } from '../spatial/private-spatial.guard';
import { EvidenceExceptionFilter, readUspBody, UspJsonPost, uspEnvelope } from './evidence.http';

@ApiTags('USP private immutable packet plans')
@UseFilters(EvidenceExceptionFilter)
@UseGuards(PrivateSpatialGuard)
@Controller('api/v1/usp/packets/plans')
export class PacketPlansController {
  @Post('create') @HttpCode(200)
  @UspJsonPost('POST_api_v1_usp_packets_plans_create', 'Create one immutable selected-target text/CSV plan', UspCreatePacketPlanSchema, UspPacketPlanSchema)
  async create(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'private, no-store');
    const c = await readUspBody(req, UspCreatePacketPlanSchema);
    const plan = await createPacketPlan(localRequestContext(requestId(req)), c);
    return uspEnvelope(req, plan.input.scope, plan);
  }
  @Post('read') @HttpCode(200)
  @UspJsonPost('POST_api_v1_usp_packets_plans_read', 'Read one exact immutable plan version under current access', UspReadPacketPlanSchema, UspPacketPlanViewSchema)
  async read(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'private, no-store');
    const c = await readUspBody(req, UspReadPacketPlanSchema);
    const view = await readPacketPlan(localRequestContext(requestId(req)), c);
    return uspEnvelope(req, view.plan.input.scope, view);
  }
  @Post('revise') @HttpCode(200)
  @UspJsonPost('POST_api_v1_usp_packets_plans_revise', 'Append explicit decisions as a new immutable version', UspRevisePacketPlanSchema, UspPacketPlanSchema)
  async revise(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'private, no-store');
    const c = await readUspBody(req, UspRevisePacketPlanSchema);
    const plan = await revisePacketPlan(localRequestContext(requestId(req)), c);
    return uspEnvelope(req, plan.input.scope, plan);
  }
  @Post('confirm') @HttpCode(200)
  @UspJsonPost('POST_api_v1_usp_packets_plans_confirm', 'Confirm the reviewed exact plan hash and complete required context', UspConfirmPacketPlanSchema, UspPacketPlanConfirmationSchema)
  async confirm(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'private, no-store');
    const c = await readUspBody(req, UspConfirmPacketPlanSchema);
    const confirmation = await confirmPacketPlan(localRequestContext(requestId(req)), c);
    const view = await readPacketPlan(localRequestContext(requestId(req)), { planId: c.planId, version: c.version });
    return uspEnvelope(req, view.plan.input.scope, confirmation);
  }
  @Post('execute') @HttpCode(200)
  @UspJsonPost('POST_api_v1_usp_packets_plans_execute', 'Execute the confirmed version through existing private PACK0', UspExecutePacketPlanSchema, UspPacketPlanExecutionSchema)
  async execute(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'private, no-store');
    const c = await readUspBody(req, UspExecutePacketPlanSchema);
    const result = await executePacketPlan(localRequestContext(requestId(req)), c);
    return uspEnvelope(req, result.packet.scope, result);
  }
}
