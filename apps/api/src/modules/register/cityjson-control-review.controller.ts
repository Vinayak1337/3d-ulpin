import {Controller,Get,Header,HttpCode,Inject,Param,Post,Req,UseGuards} from '@nestjs/common';
import {ApiOperation,ApiTags} from '@nestjs/swagger';
import type {Request} from 'express';
import {z} from 'zod';
import {CityJSONControlReviewService} from '@ulpin/server/modules/registry/cityjson-control-review';
import {RegistryCityJSONControlReviewRequestSchema,RegistryCityJSONControlReviewReadSchema,RegistryCityJSONControlReviewIdSchema,
  CITYJSON_CONTROL_REVIEW_LIMITS} from '../../../../../packages/contracts/src/registry-cityjson-control-review';
import {AppError} from '@ulpin/server/infrastructure/errors';
import {PrivateSpatialGuard} from '../spatial/private-spatial.guard';
import {readJsonBody} from '../../common/body';
import {ApiContract,requestSchema} from './documentation';

@ApiTags('registry native control comparison reviews')
@UseGuards(PrivateSpatialGuard)
@Controller('api/v1/registry-drafts')
export class CityJSONControlReviewController{
  constructor(@Inject(CityJSONControlReviewService) private readonly service:CityJSONControlReviewService){}
  @Post(':draftId/native-exterior/control-assessment/reviews') @HttpCode(200)
  @Header('Cache-Control','private, no-store')
  @ApiOperation({operationId:'POST_api_v1_registry_drafts_draftId_native_exterior_control_assessment_reviews',
    summary:'Retain an exact recomputed point-control comparison and scoped officer decision; no accuracy or admission pass'})
  @ApiContract(200,requestSchema(RegistryCityJSONControlReviewReadSchema),RegistryCityJSONControlReviewRequestSchema)
  async create(@Param('draftId') draftId:string,@Req() request:Request){
    this.noQuery(request);const input=RegistryCityJSONControlReviewRequestSchema.parse(await readJsonBody(request,CITYJSON_CONTROL_REVIEW_LIMITS.requestBytes));
    return this.service.create(z.uuid().parse(draftId),input);
  }
  @Get(':draftId/native-exterior/control-assessment/reviews/:reviewId')
  @Header('Cache-Control','private, no-store')
  @ApiOperation({operationId:'GET_api_v1_registry_drafts_draftId_native_exterior_control_assessment_reviews_reviewId',
    summary:'Read the exact immutable control-comparison decision under current private authority'})
  @ApiContract(200,requestSchema(RegistryCityJSONControlReviewReadSchema))
  read(@Param('draftId') draftId:string,@Param('reviewId') reviewId:string,@Req() request:Request){
    this.noQuery(request);return this.service.read(z.uuid().parse(draftId),RegistryCityJSONControlReviewIdSchema.parse(reviewId));
  }
  private noQuery(request:Request){if(Object.keys(request.query??{}).length)
    throw new AppError(400,'CITYJSON_CONTROL_REVIEW_QUERY','Use only the bounded explicit control-review body or identity.');}
}
