import {Controller,Get,Header,Inject,Param,Req,Res,UseGuards} from '@nestjs/common';
import {ApiOperation,ApiParam,ApiQuery,ApiResponse,ApiTags} from '@nestjs/swagger';
import type {Request,Response} from 'express';
import {z} from 'zod';
import {DocumentImageSchema} from '../../../../../packages/contracts/src/document-images';
import {DocumentImagesService} from '@ulpin/server/modules/usp/ingestion/document-images';
import {AppError} from '@ulpin/server/infrastructure/errors';
import {idSchema} from '@ulpin/server/infrastructure/validation';
import {PrivateSpatialGuard} from '../spatial/private-spatial.guard';

function query(request:Request){
  const parameters=new URL(request.originalUrl??request.url,'http://localhost').searchParams;
  for(const key of parameters.keys())if(parameters.getAll(key).length!==1)
    throw new AppError(422,'DOCUMENT_IMAGE_QUERY','Use one exact value for each image pin.');
  return Object.fromEntries(parameters);
}
const {$schema:_dialect,...responseSchema}=z.toJSONSchema(DocumentImageSchema,{io:'input',target:'openapi-3.0'});

@ApiTags('Private document images')
@UseGuards(PrivateSpatialGuard)
@Controller('api/v1/sources/:sourceId/image')
export class DocumentImagesController{
  constructor(@Inject(DocumentImagesService) private readonly service:DocumentImagesService){}

  @Get()
  @Header('Cache-Control','private, no-store')
  @ApiOperation({operationId:'GET_api_v1_sources_sourceId_image',summary:'Inspect exact retained PNG/JPEG pixel frames; calibration remains unavailable'})
  @ApiParam({name:'sourceId',schema:{type:'string',format:'uuid'}})
  @ApiQuery({name:'revision',required:true,schema:{type:'integer',minimum:1}})
  @ApiQuery({name:'sha256',required:true,schema:{type:'string',pattern:'^[a-f0-9]{64}$'}})
  @ApiResponse({status:200,schema:responseSchema as never})
  async image(@Param('sourceId') sourceId:string,@Req() request:Request){
    return this.service.image(idSchema.parse(sourceId),query(request));
  }

  @Get('raster')
  @Header('Cache-Control','private, no-store')
  @ApiOperation({operationId:'GET_api_v1_sources_sourceId_image_raster',summary:'Decode one explicitly pinned private PNG/JPEG original into a bounded metadata-free display PNG'})
  @ApiParam({name:'sourceId',schema:{type:'string',format:'uuid'}})
  @ApiQuery({name:'revision',required:true,schema:{type:'integer',minimum:1}})
  @ApiQuery({name:'sha256',required:true,schema:{type:'string',pattern:'^[a-f0-9]{64}$'}})
  @ApiResponse({status:200,content:{'image/png':{schema:{type:'string',format:'binary'}}}})
  async raster(@Param('sourceId') sourceId:string,@Req() request:Request,@Res() response:Response){
    const data=await this.service.raster(idSchema.parse(sourceId),query(request));
    response.setHeader('Cache-Control','private, no-store');response.setHeader('Content-Type','image/png');
    response.setHeader('Content-Length',String(data.bytes.length));response.setHeader('X-Content-Type-Options','nosniff');
    response.setHeader('Content-Disposition','inline; filename="image.png"');
    response.setHeader('X-Source-Revision',String(data.sourceRevision));response.setHeader('X-Source-Sha256',data.sourceSha256);
    response.setHeader('X-Render-Sha256',data.render.sha256);
    response.setHeader('X-Image-Source-Pixels',`${data.sourceFrame.width},${data.sourceFrame.height}`);
    response.setHeader('X-Image-Display-Pixels',`${data.display.frame.width},${data.display.frame.height}`);
    response.setHeader('X-Image-Orientation',`${data.orientation.provenance};${data.orientation.applied}`);
    response.setHeader('X-Image-Pixel-Affine',data.display.sourceToRaster.join(','));
    response.setHeader('X-Image-Pixel-Convention',data.display.coordinateConvention);
    response.end(data.bytes);
  }
}
