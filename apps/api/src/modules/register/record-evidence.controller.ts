import {Controller,Get,Header,Inject,Param,Req,UseGuards} from '@nestjs/common';
import {ApiOperation,ApiParam,ApiTags} from '@nestjs/swagger';
import type {Request} from 'express';
import {RegistryRecordEvidenceService} from '@ulpin/server/modules/registry/registry-record-evidence';
import {AppError} from '@ulpin/server/infrastructure/errors';
import {RegistryRecordEvidenceRequestSchema,RegistryRecordEvidenceSchema}
  from '../../../../../packages/contracts/src/registry-record-evidence';
import {PrivateSpatialGuard} from '../spatial/private-spatial.guard';
import {ApiContract,requestSchema} from './documentation';

@ApiTags('private committed registry evidence')
@UseGuards(PrivateSpatialGuard)
@Controller('api/v1/registry-records')
export class RegistryRecordEvidenceController{
  constructor(@Inject(RegistryRecordEvidenceService) private readonly service:RegistryRecordEvidenceService){}
  @Get(':recordId/revisions/:revision/document-citations')
  @Header('Cache-Control','private, no-store')
  @ApiOperation({operationId:'GET_api_v1_registry_records_recordId_revisions_revision_document_citations',
    summary:'Read exact committed citations under current private source and target authority'})
  @ApiParam({name:'recordId',schema:{type:'string',format:'uuid'}})
  @ApiParam({name:'revision',schema:{type:'integer',minimum:1,maximum:2147483647}})
  @ApiContract(200,requestSchema(RegistryRecordEvidenceSchema))
  read(@Param('recordId') recordId:string,@Param('revision') revision:string,@Req() request:Request){
    if(Object.keys(request.query??{}).length||new URL(request.originalUrl??request.url,'http://localhost').search)
      throw new AppError(400,'REGISTRY_RECORD_EVIDENCE_QUERY','Use only the exact committed record and revision path.');
    if(!/^[1-9][0-9]{0,9}$/.test(revision))
      throw new AppError(400,'REGISTRY_RECORD_EVIDENCE_REVISION','Use a bounded positive integer revision.');
    const input=RegistryRecordEvidenceRequestSchema.parse({recordId,revision:Number(revision)});
    return this.service.read(input.recordId,input.revision);
  }
}
