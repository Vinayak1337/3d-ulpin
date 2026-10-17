import {Body,Controller,Inject,Param,Post,Res,UseGuards} from '@nestjs/common';
import {ApiBody,ApiOperation,ApiParam,ApiResponse,ApiTags} from '@nestjs/swagger';
import type {Response} from 'express';
import {z} from 'zod';
import {PacketImageRegionRequestSchema} from '../../../../../packages/contracts/src/packet-image-region';
import {PacketImageRegionService} from '@ulpin/server/modules/usp/packets/image-region';
import {idSchema} from '@ulpin/server/infrastructure/validation';
import {PrivateSpatialGuard} from '../spatial/private-spatial.guard';

const {$schema:_dialect,...requestSchema}=z.toJSONSchema(PacketImageRegionRequestSchema,{io:'input',target:'openapi-3.0'});
@ApiTags('Private packet image region prerequisite')
@UseGuards(PrivateSpatialGuard)
@Controller('api/v1/usp/packets/sources/:sourceId/image-region')
export class PacketImageRegionController{
  constructor(@Inject(PacketImageRegionService) private readonly service:PacketImageRegionService){}
  @Post()
  @ApiOperation({operationId:'POST_api_v1_usp_packets_sources_sourceId_image_region',
    summary:'Crop an acknowledged oriented PNG/JPEG original; source-only preview with unassessed applicability'})
  @ApiParam({name:'sourceId',schema:{type:'string',format:'uuid'}})
  @ApiBody({schema:requestSchema as never})
  @ApiResponse({status:200,headers:{'X-Region-Provenance':{description:'Base64url JSON matching PacketImageRegionProvenanceSchema',schema:{type:'string'}},
    'X-Region-Sha256':{schema:{type:'string',pattern:'^[a-f0-9]{64}$'}}},
    content:{'image/png':{schema:{type:'string',format:'binary'}}}})
  async region(@Param('sourceId') sourceId:string,@Body() body:unknown,@Res() response:Response){
    const result=await this.service.extract(idSchema.parse(sourceId),body);
    response.status(200);response.setHeader('Cache-Control','private, no-store');response.setHeader('Content-Type','image/png');
    response.setHeader('Content-Length',String(result.bytes.length));response.setHeader('X-Content-Type-Options','nosniff');
    response.setHeader('Content-Disposition','inline; filename="image-region.png"');
    response.setHeader('X-Region-Sha256',result.provenance.output.sha256);
    response.setHeader('X-Region-Provenance',Buffer.from(JSON.stringify(result.provenance)).toString('base64url'));
    response.end(result.bytes);
  }
}
