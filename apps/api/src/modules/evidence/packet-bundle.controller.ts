import {Controller,Get,HttpCode,Param,Req,Res,UseFilters,UseGuards} from '@nestjs/common';
import {ApiOperation,ApiParam,ApiResponse,ApiTags} from '@nestjs/swagger';
import type {Request,Response} from 'express';
import {z} from 'zod';
import {readPacketPdfBundle} from '@ulpin/server/modules/usp/packets/pdf-bundle';
import {AppError} from '@ulpin/server/infrastructure/errors';
import {localRequestContext} from '@ulpin/server/modules/usp/principal';
import {requestId} from '../../common/request-context';
import {PrivateSpatialGuard} from '../spatial/private-spatial.guard';
import {EvidenceExceptionFilter} from './evidence.http';

@ApiTags('USP private accepted PDF bundles')
@UseFilters(EvidenceExceptionFilter)
@UseGuards(PrivateSpatialGuard)
@Controller('api/v1/usp/packets/pdf')
export class PacketBundleController{
  @Get(':packetId/bundle') @HttpCode(200)
  @ApiOperation({operationId:'GET_api_v1_usp_packets_pdf_packetId_bundle',summary:'Download an exact accepted private PDF and bounded provenance manifest as a generated compilation ZIP'})
  @ApiParam({name:'packetId',schema:{type:'string',format:'uuid'}})
  @ApiResponse({status:200,content:{'application/zip':{schema:{type:'string',format:'binary'}}}})
  async bundle(@Param('packetId') value:string,@Req() req:Request,@Res() res:Response){
    res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');
    if(new URL(req.originalUrl??req.url,'http://localhost').searchParams.size)
      throw new AppError(422,'PACKET_PDF_QUERY','This exact PDF bundle download has no query fields.');
    const packetId=z.uuid().parse(value),result=await readPacketPdfBundle(localRequestContext(requestId(req)),packetId);
    res.setHeader('Content-Type','application/zip');res.setHeader('Content-Length',String(result.bytes.length));
    res.setHeader('Content-Disposition',`attachment; filename="packet-${packetId}.zip"`);res.end(Buffer.from(result.bytes));
  }
}
