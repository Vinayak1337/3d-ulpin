import {Controller,Header,HttpCode,Inject,Param,Post,Req,UseGuards} from '@nestjs/common';
import {ApiOperation,ApiTags} from '@nestjs/swagger';
import type {Request} from 'express';
import {z} from 'zod';
import {CityJSONControlAssessmentService} from '@ulpin/server/modules/registry/cityjson-control-assessment';
import {RegistryCityJSONControlRequestSchema,RegistryCityJSONControlAssessmentSchema,CITYJSON_CONTROL_LIMITS}
  from '../../../../../packages/contracts/src/registry-cityjson-control-assessment';
import {AppError} from '@ulpin/server/infrastructure/errors';
import {PrivateSpatialGuard} from '../spatial/private-spatial.guard';
import {readJsonBody} from '../../common/body';
import {ApiContract,requestSchema} from './documentation';

@ApiTags('registry native control comparisons')
@UseGuards(PrivateSpatialGuard)
@Controller('api/v1/registry-drafts')
export class CityJSONControlAssessmentController{
  constructor(@Inject(CityJSONControlAssessmentService) private readonly service:CityJSONControlAssessmentService){}
  @Post(':draftId/native-exterior/control-assessment') @HttpCode(200)
  @Header('Cache-Control','private, no-store')
  @ApiOperation({operationId:'POST_api_v1_registry_drafts_draftId_native_exterior_control_assessment',
    summary:'Compare exact source-backed control points with selected native vertices; no accuracy or admission pass'})
  @ApiContract(200,requestSchema(RegistryCityJSONControlAssessmentSchema),RegistryCityJSONControlRequestSchema)
  async assess(@Param('draftId') draftId:string,@Req() request:Request){
    if(Object.keys(request.query??{}).length)throw new AppError(400,'CITYJSON_CONTROL_QUERY','Use only the bounded explicit comparison body.');
    const input=RegistryCityJSONControlRequestSchema.parse(await readJsonBody(request,CITYJSON_CONTROL_LIMITS.requestBytes));
    return this.service.assess(z.uuid().parse(draftId),input);
  }
}
