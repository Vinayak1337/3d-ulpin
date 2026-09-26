import { Controller, Get, HttpCode, Param, Post, Req, Res, UseFilters } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { Request, Response as ExpressResponse } from 'express';
import { UspReadEvidenceRequestSchema } from '@ulpin/contracts/usp';
import { sendWebResponse } from '../../common/response';
import { requestId } from '../../common/request-context';
import { EvidenceExceptionFilter, parseUspPath, readUspBody, UspBinaryPost,
  UspJsonPost, UspPacketGet, uspEnvelope } from './evidence.http';
import { evidenceSchemas } from './evidence.schemas';
import { CityJsonEvidenceService, DecisionEvidenceService, OriginalEvidenceService,
  PacketEvidenceService, SnapshotEvidenceService } from './evidence.services';

@ApiTags('USP snapshots and scopes')
@UseFilters(EvidenceExceptionFilter)
@Controller('api/v1/usp')
export class SnapshotEvidenceController {
  constructor(private readonly service: SnapshotEvidenceService) {}

  @Post('snapshots')
  @HttpCode(200)
  @UspJsonPost('POST_api_v1_usp_snapshots', 'Capture an exact recorded registry snapshot',
    evidenceSchemas.snapshots.request, evidenceSchemas.snapshots.response)
  async capture(@Req() request: Request) {
    const input = await readUspBody(request, evidenceSchemas.snapshots.request);
    const data = await this.service.capture(requestId(request), input);
    return uspEnvelope(request, data.scope, data);
  }

  @Post('snapshots/read')
  @HttpCode(200)
  @UspJsonPost('POST_api_v1_usp_snapshots_read', 'Read a pinned snapshot manifest',
    evidenceSchemas.snapshotRead.request, evidenceSchemas.snapshotRead.response)
  async read(@Req() request: Request) {
    const input = await readUspBody(request, evidenceSchemas.snapshotRead.request);
    return uspEnvelope(request, input.scope, await this.service.read(requestId(request), input.scope));
  }

  @Post('scope/read')
  @HttpCode(200)
  @UspJsonPost('POST_api_v1_usp_scope_read', 'Page targets within an exact scope',
    evidenceSchemas.scopeRead.request, evidenceSchemas.scopeRead.response)
  async scope(@Req() request: Request) {
    const input = await readUspBody(request, evidenceSchemas.scopeRead.request);
    return uspEnvelope(request, input.scope, await this.service.scope(requestId(request), input));
  }

  @Post('targets/resolve')
  @HttpCode(200)
  @UspJsonPost('POST_api_v1_usp_targets_resolve', 'Resolve an exact target pin',
    evidenceSchemas.targetResolve.request, evidenceSchemas.targetResolve.response)
  async resolve(@Req() request: Request) {
    const input = await readUspBody(request, evidenceSchemas.targetResolve.request);
    return uspEnvelope(request, input.scope, await this.service.resolve(requestId(request), input));
  }

  @Post('targets/vertical')
  @HttpCode(200)
  @UspJsonPost('POST_api_v1_usp_targets_vertical', 'Resolve a validated building, floor and space chain',
    evidenceSchemas.targetVertical.request, evidenceSchemas.targetVertical.response)
  async vertical(@Req() request: Request) {
    const input = await readUspBody(request, evidenceSchemas.targetVertical.request);
    return uspEnvelope(request, input.scope, await this.service.vertical(requestId(request), input));
  }
}

@ApiTags('USP original evidence')
@UseFilters(EvidenceExceptionFilter)
@Controller('api/v1/usp/evidence')
export class OriginalEvidenceController {
  constructor(private readonly service: OriginalEvidenceService) {}

  @Post('original')
  @HttpCode(200)
  @UspBinaryPost('POST_api_v1_usp_evidence_original', 'Download an authorized unchanged original',
    evidenceSchemas.original.request)
  async original(@Req() request: Request, @Res() response: ExpressResponse) {
    const input = await readUspBody(request, UspReadEvidenceRequestSchema);
    const { bytes, authorization } = await this.service.original(requestId(request), input);
    await sendWebResponse(response, new Response(Uint8Array.from(bytes), { headers: {
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'Content-Type': authorization.mediaType, 'Content-Disposition': 'attachment',
      'X-Source-SHA256': authorization.asset.sha256,
    } }));
  }

  @Post('part')
  @HttpCode(200)
  @UspJsonPost('POST_api_v1_usp_evidence_part', 'Read an exact linked text part or its unavailable state',
    evidenceSchemas.exactPart.request, evidenceSchemas.exactPart.response)
  async part(@Req() request: Request) {
    const input = await readUspBody(request, UspReadEvidenceRequestSchema);
    return uspEnvelope(request, input.scope, await this.service.part(requestId(request), input));
  }
}

@ApiTags('USP proposals and project identity')
@UseFilters(EvidenceExceptionFilter)
@Controller('api/v1/usp')
export class DecisionEvidenceController {
  constructor(private readonly service: DecisionEvidenceService) {}

  @Post('proposals/prepare')
  @HttpCode(200)
  @UspJsonPost('POST_api_v1_usp_proposals_prepare', 'Prepare a guarded registry proposal',
    evidenceSchemas.prepare.request, evidenceSchemas.prepare.response)
  async prepare(@Req() request: Request) {
    const input = await readUspBody(request, evidenceSchemas.prepare.request);
    return uspEnvelope(request, input.scope, await this.service.prepare(requestId(request), input));
  }

  @Post('proposals/commit')
  @HttpCode(200)
  @UspJsonPost('POST_api_v1_usp_proposals_commit', 'Commit an exact reviewed proposal',
    evidenceSchemas.commit.request, evidenceSchemas.commit.response)
  async commit(@Req() request: Request) {
    const input = await readUspBody(request, evidenceSchemas.commit.request);
    const data = await this.service.commit(requestId(request), input);
    return uspEnvelope(request, data.snapshot, data);
  }

  @Post('identity/reviews')
  @HttpCode(200)
  @UspJsonPost('POST_api_v1_usp_identity_reviews', 'Record an exact project identity review',
    evidenceSchemas.identityReview.request, evidenceSchemas.identityReview.response)
  async review(@Req() request: Request) {
    const input = await readUspBody(request, evidenceSchemas.identityReview.request);
    return uspEnvelope(request, input.scope, await this.service.review(requestId(request), input));
  }

  @Post('identity/assign')
  @HttpCode(200)
  @UspJsonPost('POST_api_v1_usp_identity_assign', 'Assign an immutable proposed project code',
    evidenceSchemas.identityAssign.request, evidenceSchemas.identityAssign.response)
  async assign(@Req() request: Request) {
    const input = await readUspBody(request, evidenceSchemas.identityAssign.request);
    const data = await this.service.assign(requestId(request), input);
    return uspEnvelope(request, data.snapshot, data);
  }

  @Post('identity/mutate')
  @HttpCode(200)
  @UspJsonPost('POST_api_v1_usp_identity_mutate', 'Review and record identity lifecycle changes',
    evidenceSchemas.identityMutate.request, evidenceSchemas.identityMutate.response)
  async mutate(@Req() request: Request) {
    const input = await readUspBody(request, evidenceSchemas.identityMutate.request);
    const data = await this.service.mutate(requestId(request), input);
    return uspEnvelope(request, data.snapshot, data);
  }

  @Post('identity/resolve')
  @HttpCode(200)
  @UspJsonPost('POST_api_v1_usp_identity_resolve', 'Resolve a retained identity within an exact snapshot',
    evidenceSchemas.identityResolve.request, evidenceSchemas.identityResolve.response)
  async resolve(@Req() request: Request) {
    const input = await readUspBody(request, evidenceSchemas.identityResolve.request);
    return uspEnvelope(request, input.scope, await this.service.resolveIdentity(requestId(request), input));
  }
}

@ApiTags('USP CityJSON exchange')
@UseFilters(EvidenceExceptionFilter)
@Controller('api/v1/usp/exchange/cityjson')
export class CityJsonEvidenceController {
  constructor(private readonly service: CityJsonEvidenceService) {}

  @Post('export')
  @HttpCode(200)
  @UspJsonPost('POST_api_v1_usp_exchange_cityjson_export', 'Export private CityJSON 2.0 with bound provenance sidecar',
    evidenceSchemas.cityJsonExport.request, evidenceSchemas.cityJsonExport.response)
  async export(@Req() request: Request) {
    const input = await readUspBody(request, evidenceSchemas.cityJsonExport.request);
    return uspEnvelope(request, input.scope, await this.service.export(requestId(request), input));
  }

  @Post('compare')
  @HttpCode(200)
  @UspJsonPost('POST_api_v1_usp_exchange_cityjson_compare', 'Compare CityJSON and sidecar without mutation',
    evidenceSchemas.cityJsonCompare.request, evidenceSchemas.cityJsonCompare.response)
  async compare(@Req() request: Request) {
    const input = await readUspBody(request, evidenceSchemas.cityJsonCompare.request);
    return uspEnvelope(request, input.scope, await this.service.compare(requestId(request), input));
  }
}

@ApiTags('USP scoped packets')
@UseFilters(EvidenceExceptionFilter)
@Controller('api/v1/usp/packets')
export class PacketEvidenceController {
  constructor(private readonly service: PacketEvidenceService) {}

  @Post()
  @HttpCode(200)
  @UspJsonPost('POST_api_v1_usp_packets', 'Create a private target-scoped text or CSV packet',
    evidenceSchemas.packetCreate.request, evidenceSchemas.packetCreate.response)
  async create(@Req() request: Request) {
    const input = await readUspBody(request, evidenceSchemas.packetCreate.request);
    return uspEnvelope(request, input.scope, await this.service.create(requestId(request), input));
  }

  @Get(':packetId/receipt')
  @HttpCode(200)
  @UspPacketGet('GET_api_v1_usp_packets_packetId_receipt', true)
  async receipt(@Req() request: Request, @Param('packetId') rawPacketId: string) {
    const packetId = parseUspPath(z.uuid(), rawPacketId);
    const data = await this.service.receipt(requestId(request), packetId);
    return uspEnvelope(request, data.scope, data);
  }

  @Get(':packetId')
  @HttpCode(200)
  @UspPacketGet('GET_api_v1_usp_packets_packetId', false)
  async download(@Req() request: Request, @Param('packetId') rawPacketId: string,
    @Res() response: ExpressResponse) {
    const packetId = parseUspPath(z.uuid(), rawPacketId);
    const { bytes, receipt } = await this.service.read(requestId(request), packetId);
    await sendWebResponse(response, new Response(Uint8Array.from(bytes), { headers: {
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'Content-Type': receipt.contentType,
      'Content-Disposition': `attachment; filename="packet-${receipt.packetId}.${receipt.format === 'csv' ? 'csv' : 'txt'}"`,
      'X-Artifact-SHA256': receipt.artifact.sha256,
    } }));
  }
}
