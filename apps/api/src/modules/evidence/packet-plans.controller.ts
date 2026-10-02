import { Controller, HttpCode, Post, Get, Param, Req, Res, UseFilters, UseGuards } from '@nestjs/common';
import { ApiTags,ApiOperation,ApiParam,ApiResponse } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { UspCreatePacketPlanSchema, UspRevisePacketPlanSchema, UspReadPacketPlanSchema,
  UspConfirmPacketPlanSchema, UspExecutePacketPlanSchema, UspPacketPlanSchema,
  UspPacketPlanViewSchema, UspPacketPlanConfirmationSchema, UspPacketPlanExecutionSchema,
} from '../../../../../packages/contracts/src/usp/packets';
import { createPacketPlan, revisePacketPlan, readPacketPlan, confirmPacketPlan,
  executePacketPlan } from '@ulpin/server/modules/usp/packets/plan-service';
import {readPacketPdf} from '@ulpin/server/modules/usp/packets/pdf-service';
import {AppError} from '@ulpin/server/infrastructure/errors';
import {z} from 'zod';
import { localRequestContext } from '@ulpin/server/modules/usp/principal';
import { requestId } from '../../common/request-context';
import { PrivateSpatialGuard } from '../spatial/private-spatial.guard';
import { EvidenceExceptionFilter, readUspBody, UspJsonPost, uspEnvelope } from './evidence.http';

@ApiTags('USP private immutable packet plans')
@UseFilters(EvidenceExceptionFilter)
@UseGuards(PrivateSpatialGuard)
@Controller('api/v1/usp/packets')
export class PacketPlansController {
  @Post('plans/create') @HttpCode(200)
  @UspJsonPost('POST_api_v1_usp_packets_plans_create', 'Create one immutable selected-target text/CSV or ordered required-region PDF plan', UspCreatePacketPlanSchema, UspPacketPlanSchema)
  async create(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'private, no-store');
    const c = await readUspBody(req, UspCreatePacketPlanSchema);
    const plan = await createPacketPlan(localRequestContext(requestId(req)), c);
    return uspEnvelope(req, plan.input.scope, plan);
  }
  @Post('plans/read') @HttpCode(200)
  @UspJsonPost('POST_api_v1_usp_packets_plans_read', 'Read one exact immutable plan version under current access', UspReadPacketPlanSchema, UspPacketPlanViewSchema)
  async read(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'private, no-store');
    const c = await readUspBody(req, UspReadPacketPlanSchema);
    const view = await readPacketPlan(localRequestContext(requestId(req)), c);
    return uspEnvelope(req, view.plan.input.scope, view);
  }
  @Post('plans/revise') @HttpCode(200)
  @UspJsonPost('POST_api_v1_usp_packets_plans_revise', 'Append explicit decisions or ordered required regions as a new immutable version', UspRevisePacketPlanSchema, UspPacketPlanSchema)
  async revise(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'private, no-store');
    const c = await readUspBody(req, UspRevisePacketPlanSchema);
    const plan = await revisePacketPlan(localRequestContext(requestId(req)), c);
    return uspEnvelope(req, plan.input.scope, plan);
  }
  @Post('plans/confirm') @HttpCode(200)
  @UspJsonPost('POST_api_v1_usp_packets_plans_confirm', 'Confirm the reviewed exact plan hash and complete required context', UspConfirmPacketPlanSchema, UspPacketPlanConfirmationSchema)
  async confirm(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'private, no-store');
    const c = await readUspBody(req, UspConfirmPacketPlanSchema);
    const confirmation = await confirmPacketPlan(localRequestContext(requestId(req)), c);
    const view = await readPacketPlan(localRequestContext(requestId(req)), { planId: c.planId, version: c.version });
    return uspEnvelope(req, view.plan.input.scope, confirmation);
  }
  @Post('plans/execute') @HttpCode(200)
  @UspJsonPost('POST_api_v1_usp_packets_plans_execute', 'Execute the confirmed exact version to private text/CSV or one clean image-only PDF', UspExecutePacketPlanSchema, UspPacketPlanExecutionSchema)
  async execute(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'private, no-store');
    const c = await readUspBody(req, UspExecutePacketPlanSchema);
    const result = await executePacketPlan(localRequestContext(requestId(req)), c);
    return uspEnvelope(req, result.packet.scope, result);
  }
  @Get('pdf/:packetId/download') @HttpCode(200)
  @ApiOperation({operationId:'GET_api_v1_usp_packets_pdf_packetId_download',summary:'Download the exact private generated PDF of required regions under current source, target and plan authority'})
  @ApiParam({name:'packetId',schema:{type:'string',format:'uuid'}})
  @ApiResponse({status:200,content:{'application/pdf':{schema:{type:'string',format:'binary'}}}})
  async downloadPdf(@Param('packetId') value:string,@Req() req:Request,@Res() res:Response){
    if(new URL(req.originalUrl??req.url,'http://localhost').searchParams.size)
      throw new AppError(422,'PACKET_PDF_QUERY','This exact PDF download has no query fields.');
    const packetId=z.uuid().parse(value),result=await readPacketPdf(localRequestContext(requestId(req)),packetId);
    res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Length',String(result.bytes.length));
    res.setHeader('Content-Disposition',`attachment; filename="packet-${packetId}.pdf"`);
    res.end(Buffer.from(result.bytes));
  }
}
