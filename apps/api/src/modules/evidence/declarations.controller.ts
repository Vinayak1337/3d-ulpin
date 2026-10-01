import { Controller, HttpCode, Post, Req, Res, UseFilters, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { UspPrepareDeclarationSchema, UspCommitDeclarationSchema, UspDeclarationProposalResultSchema,
  UspDeclarationCommitReceiptSchema, UspReviewDeclarationSchema, UspDeclarationReviewResultSchema,
  UspReadDeclarationSchema, UspSelectedDeclarationSchema, UspReadDeclarationProposalSchema, UspDeclarationDraftSchema,
} from '@ulpin/contracts/usp';
import { prepareProposal, commitProposal, reviewDeclaration } from '@ulpin/server/modules/usp/commands';
import { readSelectedDeclaration, readDeclarationProposal } from '@ulpin/server/modules/usp/declarations/service';
import { localRequestContext } from '@ulpin/server/modules/usp/principal';
import { requestId } from '../../common/request-context';
import { PrivateSpatialGuard } from '../spatial/private-spatial.guard';
import { EvidenceExceptionFilter, readUspBody, UspJsonPost, uspEnvelope } from './evidence.http';

const prepareSchema = UspPrepareDeclarationSchema;
const commitSchema = UspCommitDeclarationSchema;
@ApiTags('USP private declaration ledger')
@UseFilters(EvidenceExceptionFilter)
@UseGuards(PrivateSpatialGuard)
@Controller('api/v1/usp/rights/declarations')
export class DeclarationsController {
  @Post('prepare') @HttpCode(200)
  @UspJsonPost('POST_api_v1_usp_rights_declarations_prepare', 'Draft one source-defined declaration revision', prepareSchema, UspDeclarationProposalResultSchema)
  async prepare(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'private, no-store');
    const c = await readUspBody(req, prepareSchema);
    return uspEnvelope(req, c.scope, await prepareProposal(localRequestContext(requestId(req)), c));
  }
  @Post('proposal') @HttpCode(200)
  @UspJsonPost('POST_api_v1_usp_rights_declarations_proposal', 'Inspect a draft with explicit population selection', UspReadDeclarationProposalSchema, UspDeclarationDraftSchema)
  async proposal(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'private, no-store');
    const c = await readUspBody(req, UspReadDeclarationProposalSchema);
    return uspEnvelope(req, c.scope, await readDeclarationProposal(localRequestContext(requestId(req)), c));
  }
  @Post('review') @HttpCode(200)
  @UspJsonPost('POST_api_v1_usp_rights_declarations_review', 'Review exact shares, population, consent and target applicability', UspReviewDeclarationSchema, UspDeclarationReviewResultSchema)
  async review(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'private, no-store');
    const c = await readUspBody(req, UspReviewDeclarationSchema);
    return uspEnvelope(req, c.scope, await reviewDeclaration(localRequestContext(requestId(req)), c));
  }
  @Post('accept') @HttpCode(200)
  @UspJsonPost('POST_api_v1_usp_rights_declarations_accept', 'Technically accept an immutable reviewed declaration; legal approval remains not assessed', commitSchema, UspDeclarationCommitReceiptSchema)
  async accept(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'private, no-store');
    const c = await readUspBody(req, commitSchema);
    const receipt = await commitProposal(localRequestContext(requestId(req)), c);
    return uspEnvelope(req, receipt.snapshot, receipt);
  }
  @Post('selected-target') @HttpCode(200)
  @UspJsonPost('POST_api_v1_usp_rights_declarations_selected_target', 'Read only the selected exact entry, reviewed applicability and safe aggregate coverage', UspReadDeclarationSchema, UspSelectedDeclarationSchema)
  async selected(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'private, no-store');
    const c = await readUspBody(req, UspReadDeclarationSchema);
    return uspEnvelope(req, c.scope, await readSelectedDeclaration(localRequestContext(requestId(req)), c));
  }
}
