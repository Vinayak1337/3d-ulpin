import {Controller,Get,HttpCode,Inject,Param,Post,Req,UseGuards} from '@nestjs/common';
import {ApiOperation,ApiParam,ApiTags} from '@nestjs/swagger';
import type {Request} from 'express';
import {EvaluateSufficiencySchema,SufficiencyAnswerSchema,SufficiencyResultSchema,SufficiencyQuestionSchema,NeedsInputSchema} from '@ulpin/contracts/usp';
import {IngestionSufficiencyService} from '@ulpin/server/modules/usp/ingestion/sufficiency';
import {JSON_BODY_LIMIT,readJsonBody} from '../../common/body';
import {jsonBody,wireResponse} from '../intake/wire-schemas';
import {PrivateSpatialGuard} from '../spatial/private-spatial.guard';

const param=(name:string)=>ApiParam({name,schema:{type:'string',format:'uuid'}});
@ApiTags('ingestion sufficiency')
@UseGuards(PrivateSpatialGuard)
@Controller('api/v1/ingestion')
export class SufficiencyController{
  constructor(@Inject(IngestionSufficiencyService) private readonly sufficiency:IngestionSufficiencyService){}
  @Post('cases/:caseId/sources/:sourceId/sufficiency')
  @HttpCode(200)
  @param('caseId') @param('sourceId')
  @ApiOperation({operationId:'POST_api_v1_ingestion_cases_caseId_sources_sourceId_sufficiency',summary:'Evaluate bounded source-pinned tasks including retained OBJ/glTF originals and inspect_native_context accepted metadata; preserve partial companions and unavailable/stale readers without qualifying geometry or rights'})
  @jsonBody(EvaluateSufficiencySchema) @wireResponse(200,SufficiencyResultSchema)
  async evaluate(@Param('caseId') caseId:string,@Param('sourceId') sourceId:string,@Req() req:Request){
    return this.sufficiency.evaluate(caseId,sourceId,EvaluateSufficiencySchema.parse(await readJsonBody(req,JSON_BODY_LIMIT)));
  }
  @Get('cases/:caseId/needs-input')
  @param('caseId')
  @ApiOperation({operationId:'GET_api_v1_ingestion_cases_caseId_needs_input',summary:'Read bounded current decisions and class questions from retained evidence receipts, including native mesh metadata states and current source/job/access revalidation'})
  @wireResponse(200,NeedsInputSchema)
  needsInput(@Param('caseId') caseId:string){return this.sufficiency.needsInput(caseId);}
  @Post('cases/:caseId/questions/:questionId/answers')
  @HttpCode(200)
  @param('caseId') @param('questionId')
  @ApiOperation({operationId:'POST_api_v1_ingestion_cases_caseId_questions_questionId_answers',summary:'Park a task or propose an existing evidence reference for officer review'})
  @jsonBody(SufficiencyAnswerSchema) @wireResponse(200,SufficiencyQuestionSchema)
  async answer(@Param('caseId') caseId:string,@Param('questionId') questionId:string,@Req() req:Request){
    return this.sufficiency.answer(caseId,questionId,SufficiencyAnswerSchema.parse(await readJsonBody(req,JSON_BODY_LIMIT)));
  }
}
