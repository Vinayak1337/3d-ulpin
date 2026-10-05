import {Controller,Get,Header,HttpCode,Inject,Param,Post,Req,UseGuards} from '@nestjs/common';
import {ApiOperation,ApiParam,ApiTags} from '@nestjs/swagger';
import type {Request} from 'express';
import {SPATIAL_SOURCE_REVIEW_LIMITS,SpatialSourceReviewRequestSchema,SpatialSourceReviewSchema,
  SpatialSourceReviewContextSchema} from '../../../../../packages/contracts/src/spatial-ml-source-review';
import {SpatialSourceReviewsService} from '@ulpin/server/modules/spatial/spatial-ml-source-review';
import {AppError} from '@ulpin/server/infrastructure/errors';
import {readBoundedBytes} from '../../common/body';
import {jsonBody,wireResponse} from '../intake/wire-schemas';
import {PrivateSpatialGuard} from './private-spatial.guard';
const param=(name:string)=>ApiParam({name,schema:{type:'string',format:'uuid'}});
function noQuery(request:Request){if(new URL(request.originalUrl??request.url,'http://localhost').search)
  throw new AppError(422,'ML_REVIEW_QUERY','This exact review route accepts no query parameters.');}
@ApiTags('spatial ML')
@UseGuards(PrivateSpatialGuard)
@Controller('api/v1/spatial-ml/items/:itemId/source-reviews')
export class SpatialSourceReviewsController{
  constructor(@Inject(SpatialSourceReviewsService) private readonly service:SpatialSourceReviewsService){}
  @Get('context') @Header('Cache-Control','private, no-store') @param('itemId')
  @ApiOperation({operationId:'GET_api_v1_spatial_ml_items_itemId_source_reviews_context',
    summary:'Inspect exact source-only candidate review pins through current private authority'})
  @wireResponse(200,SpatialSourceReviewContextSchema,[504])
  context(@Param('itemId') itemId:string,@Req() request:Request){noQuery(request);return this.service.context(itemId);}
  @Post() @HttpCode(201) @Header('Cache-Control','private, no-store') @param('itemId')
  @ApiOperation({operationId:'POST_api_v1_spatial_ml_items_itemId_source_reviews',
    summary:'Save immutable source-only candidate inspection decisions',
    description:'Local-process reviewed/rejected/needs_input decisions with reasons. No geometry adoption, physical target or qualified learning labels.'})
  @jsonBody(SpatialSourceReviewRequestSchema) @wireResponse(201,SpatialSourceReviewSchema,[408,504])
  async review(@Param('itemId') itemId:string,@Req() request:Request){
    noQuery(request);const bytes=await readBoundedBytes(request,SPATIAL_SOURCE_REVIEW_LIMITS.requestBytes,30000);
    let raw:unknown;try{raw=JSON.parse(bytes.toString('utf8'));}
    catch{throw new AppError(400,'INVALID_JSON','The candidate review body must be valid JSON.');}
    return this.service.review(itemId,SpatialSourceReviewRequestSchema.parse(raw));
  }
  @Get(':reviewId') @Header('Cache-Control','private, no-store') @param('itemId') @param('reviewId')
  @ApiOperation({operationId:'GET_api_v1_spatial_ml_items_itemId_source_reviews_reviewId',
    summary:'Read one exact immutable source-candidate review with current source/job/result authority'})
  @wireResponse(200,SpatialSourceReviewSchema,[504])
  read(@Param('itemId') itemId:string,@Param('reviewId') reviewId:string,@Req() request:Request){
    noQuery(request);return this.service.read(itemId,reviewId);
  }
}
