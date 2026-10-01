import {Controller,Get,Header,Inject,Param,Req,Res,UseGuards} from '@nestjs/common';
import {ApiOperation,ApiParam,ApiQuery,ApiResponse,ApiTags} from '@nestjs/swagger';
import type {Request,Response} from 'express';
import {z} from 'zod';
import {DocumentPageNumberSchema,DocumentPagesSchema} from '../../../../../packages/contracts/src/document-pages';
import {DocumentPagesService} from '@ulpin/server/modules/usp/ingestion/document-pages';
import {AppError} from '@ulpin/server/infrastructure/errors';
import {idSchema} from '@ulpin/server/infrastructure/validation';
import {PrivateSpatialGuard} from '../spatial/private-spatial.guard';

function query(request:Request){
  const parameters=new URL(request.originalUrl??request.url,'http://localhost').searchParams;
  for(const key of parameters.keys())if(parameters.getAll(key).length!==1)
    throw new AppError(422,'DOCUMENT_PAGES_QUERY','Use one exact value for each PDF page query field.');
  return Object.fromEntries(parameters);
}
const {$schema:_dialect,...responseSchema}=z.toJSONSchema(DocumentPagesSchema,{io:'input',target:'openapi-3.0'});

@ApiTags('Private document pages')
@UseGuards(PrivateSpatialGuard)
@Controller('api/v1/sources/:sourceId/pages')
export class DocumentPagesController{
  constructor(@Inject(DocumentPagesService) private readonly service:DocumentPagesService){}

  @Get()
  @Header('Cache-Control','private, no-store')
  @ApiOperation({operationId:'GET_api_v1_sources_sourceId_pages',summary:'Inspect exact retained PDF page frames; calibration remains unavailable'})
  @ApiParam({name:'sourceId',schema:{type:'string',format:'uuid'}})
  @ApiQuery({name:'revision',required:true,schema:{type:'integer',minimum:1}})
  @ApiQuery({name:'sha256',required:true,schema:{type:'string',pattern:'^[a-f0-9]{64}$'}})
  @ApiQuery({name:'offset',required:false,schema:{type:'integer',minimum:0,maximum:399,default:0}})
  @ApiQuery({name:'limit',required:false,schema:{type:'integer',minimum:1,maximum:50,default:25}})
  @ApiResponse({status:200,schema:responseSchema as never})
  async pages(@Param('sourceId') sourceId:string,@Req() request:Request){
    return this.service.pages(idSchema.parse(sourceId),query(request));
  }

  @Get(':page/raster')
  @Header('Cache-Control','private, no-store')
  @ApiOperation({operationId:'GET_api_v1_sources_sourceId_pages_page_raster',summary:'Render one explicitly selected private PDF page from its unchanged original'})
  @ApiParam({name:'sourceId',schema:{type:'string',format:'uuid'}})
  @ApiParam({name:'page',schema:{type:'integer',minimum:1,maximum:400}})
  @ApiQuery({name:'revision',required:true,schema:{type:'integer',minimum:1}})
  @ApiQuery({name:'sha256',required:true,schema:{type:'string',pattern:'^[a-f0-9]{64}$'}})
  @ApiResponse({status:200,content:{'image/png':{schema:{type:'string',format:'binary'}}}})
  async raster(@Param('sourceId') sourceId:string,@Param('page') page:string,@Req() request:Request,@Res() response:Response){
    const data=await this.service.raster(idSchema.parse(sourceId),DocumentPageNumberSchema.parse(page),query(request));
    response.setHeader('Cache-Control','private, no-store');response.setHeader('Content-Type','image/png');
    response.setHeader('Content-Length',String(data.bytes.length));response.setHeader('X-Content-Type-Options','nosniff');
    response.setHeader('Content-Disposition',`inline; filename="page-${data.page}.png"`);
    response.setHeader('X-Source-Revision',String(data.sourceRevision));response.setHeader('X-Source-Sha256',data.sourceSha256);
    response.setHeader('X-Document-Page',String(data.page));response.setHeader('X-Render-Sha256',data.render.sha256);
    response.setHeader('X-Page-Pixels',data.render.pixels.join(','));
    response.setHeader('X-Page-Frame',`${data.frame.kind};${data.frame.width},${data.frame.height};rotation=${data.frame.rotation}`);
    response.setHeader('X-Page-Pixel-Affine',`${data.render.scale};${data.render.pixelOrigin.join(',')}`);
    response.end(data.bytes);
  }
}
