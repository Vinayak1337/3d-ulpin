import {Controller,Inject,Param,Post,Req,Res,UseGuards} from '@nestjs/common';
import {ApiBody,ApiOperation,ApiParam,ApiResponse,ApiTags} from '@nestjs/swagger';
import type {Request,Response} from 'express';
import {z} from 'zod';
import {PacketRegionRequestSchema} from '../../../../../packages/contracts/src/packet-region';
import {PacketRegionService} from '@ulpin/server/modules/usp/packets/region-extract';
import {idSchema} from '@ulpin/server/infrastructure/validation';
import {PrivateSpatialGuard} from '../spatial/private-spatial.guard';
import {JSON_BODY_LIMIT,readJsonBody} from '../../common/body';
const {$schema:_dialect,...requestSchema}=z.toJSONSchema(PacketRegionRequestSchema,{io:'input',target:'openapi-3.0'});
@ApiTags('Private packet region prerequisite')
@UseGuards(PrivateSpatialGuard)
@Controller('api/v1/usp/packets/sources/:sourceId/pages/:page/region')
export class PacketRegionController{
  constructor(@Inject(PacketRegionService) private readonly service:PacketRegionService){}
  @Post()
  @ApiOperation({operationId:'POST_api_v1_usp_packets_sources_sourceId_pages_page_region',
    summary:'Extract one acknowledged private source crop; property applicability remains unassessed'})
  @ApiParam({name:'sourceId',schema:{type:'string',format:'uuid'}})
  @ApiParam({name:'page',schema:{type:'integer',minimum:1,maximum:8}})
  @ApiBody({schema:requestSchema as never})
  @ApiResponse({status:200,content:{'image/png':{schema:{type:'string',format:'binary'}}}})
  async region(@Param('sourceId') sourceId:string,@Param('page') page:string,@Req() request:Request,@Res() response:Response){
    const selected=z.string().regex(/^[1-8]$/).transform(Number).parse(page);
    const result=await this.service.extract(idSchema.parse(sourceId),selected,await readJsonBody(request,JSON_BODY_LIMIT));
    response.status(200);response.setHeader('Cache-Control','private, no-store');response.setHeader('Content-Type','image/png');
    response.setHeader('Content-Length',String(result.bytes.length));response.setHeader('X-Content-Type-Options','nosniff');
    response.setHeader('Content-Disposition','inline; filename="region.png"');
    response.setHeader('X-Region-Sha256',result.provenance.output.sha256);
    response.setHeader('X-Region-Provenance',Buffer.from(JSON.stringify(result.provenance)).toString('base64url'));
    response.end(result.bytes);
  }
}
