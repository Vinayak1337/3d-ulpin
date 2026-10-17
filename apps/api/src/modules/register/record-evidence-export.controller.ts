import {Controller,Get,Header,Inject,Param,Req,Res,UseGuards} from '@nestjs/common';
import {ApiOperation,ApiParam,ApiQuery,ApiResponse,ApiTags} from '@nestjs/swagger';
import type {Request,Response} from 'express';
import {RegistryRecordEvidenceExportService} from '@ulpin/server/modules/registry/registry-record-evidence-export';
import {AppError} from '@ulpin/server/infrastructure/errors';
import {RegistryRecordEvidenceExportQuerySchema,RegistryRecordEvidenceExportRequestSchema}
  from '../../../../../packages/contracts/src/registry-record-evidence-export';
import {PrivateSpatialGuard} from '../spatial/private-spatial.guard';

@ApiTags('private committed registry evidence')
@UseGuards(PrivateSpatialGuard)
@Controller('api/v1/registry-records')
export class RegistryRecordEvidenceExportController{
  constructor(@Inject(RegistryRecordEvidenceExportService) private readonly service:RegistryRecordEvidenceExportService){}
  @Get(':recordId/revisions/:revision/document-citations/export')
  @Header('Cache-Control','private, no-store')
  @ApiOperation({operationId:'GET_api_v1_registry_records_recordId_revisions_revision_document_citations_export',
    summary:'Download exact reviewed committed citations as private bounded text or encoded CSV'})
  @ApiParam({name:'recordId',schema:{type:'string',format:'uuid'}})
  @ApiParam({name:'revision',schema:{type:'integer',minimum:1,maximum:2147483647}})
  @ApiQuery({name:'format',required:true,schema:{type:'string',enum:['text','csv']}})
  @ApiResponse({status:200,description:'Complete private attachment; CSV data cells are JSON strings before CSV escaping. No formulas or inferred source facts.',
    content:{'text/plain':{schema:{type:'string'}},'text/csv':{schema:{type:'string'}}}})
  async read(@Param('recordId') recordId:string,@Param('revision') revision:string,@Req() request:Request,@Res() response:Response){
    const query=new URL(request.originalUrl??request.url,'http://localhost').searchParams;
    if([...query.keys()].some(key=>key!=='format')||query.getAll('format').length!==1)
      throw new AppError(400,'REGISTRY_RECORD_EVIDENCE_EXPORT_QUERY','Use exactly one format=text or format=csv query field.');
    const format=RegistryRecordEvidenceExportQuerySchema.parse(request.query).format;
    if(format!==query.get('format'))throw new AppError(400,'REGISTRY_RECORD_EVIDENCE_EXPORT_QUERY','Use one unambiguous export format.');
    if(!/^[1-9][0-9]{0,9}$/.test(revision))
      throw new AppError(400,'REGISTRY_RECORD_EVIDENCE_REVISION','Use a bounded positive integer revision.');
    const input=RegistryRecordEvidenceExportRequestSchema.parse({recordId,revision:Number(revision),format});
    // Await the complete committed transaction; no headers/body are written on refusal.
    const {metadata,body}=await this.service.read(input.recordId,input.revision,input.format);
    response.status(200).set({
      'Cache-Control':'private, no-store','Content-Type':metadata.mediaType,'Content-Length':String(metadata.bytes),
      'Content-Disposition':`attachment; filename="${metadata.filename}"`,'X-Content-Type-Options':'nosniff',
      'X-Content-SHA256':metadata.sha256,'X-Registry-Record-Id':metadata.recordId,
      'X-Registry-Record-Revision':String(metadata.recordRevision),'X-Registry-Record-Body-SHA256':metadata.recordBodySha256,
      'X-Registry-Site-Id':metadata.siteId,'X-Evidence-Export-Formatting':metadata.formatting,
    }).send(body);
  }
}
