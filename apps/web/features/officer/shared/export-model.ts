import type {AreaContext,BuildingDossier,RegistryRecord} from '@ulpin/contracts';
export type ExportIncludes={geometry:boolean;evidence:boolean;findings:boolean;history:boolean};
export const allExportIncludes:ExportIncludes={geometry:true,evidence:true,findings:true,history:true};
export function scopedRecords(dossier:BuildingDossier,id:string){
 if(!id)return dossier.records;
 const current=dossier.records.find(r=>r.id===id);if(!current)throw new Error('The selected export scope does not belong to this property.');
 if(current.kind==='floor')return dossier.records.filter(r=>r.id===id||r.kind==='space'&&r.links.some(l=>l.type==='floor'&&l.targetId===id));
 return [current];
}
export function exportPreview(input:{dossier?:BuildingDossier;context?:AreaContext;scope:string;includes:ExportIncludes}){
 const {dossier,context,scope,includes}=input;
 if(dossier){const records=scopedRecords(dossier,scope);return {name:scope?records[0].name:dossier.building.name,identifier:scope?records[0].identifier:dossier.building.identifier,records:records.length,features:1,sources:includes.evidence?dossier.sources.length:0,findings:includes.findings?dossier.issues.length:0,revision:dossier.building.revision};}
 if(!context)throw new Error('Select a retained dataset before exporting.');
 const features=scope?context.features.filter(f=>f.id===scope):context.features;
 if(scope&&!features.length)throw new Error('The selected feature is no longer in this dataset.');
 const ids=new Set(features.map(f=>f.id));
 return {name:scope?features[0].name:context.area.name,identifier:scope?features[0].identifier:context.area.id,records:0,features:features.length,sources:includes.evidence?new Set(features.map(f=>f.sourceRevisionId)).size:0,findings:includes.findings?(context.latestCheck?.findings.filter(f=>f.featureIds.some(id=>ids.has(id))).length??0):0,revision:context.area.revision};
}
export function structuredExport(input:{dossier?:BuildingDossier;context?:AreaContext;scope:string;includes:ExportIncludes}){
 const {dossier,context,scope,includes}=input,preview=exportPreview(input);
 if(dossier){const records=scopedRecords(dossier,scope),ids=new Set(records.map(r=>r.id));return {
  schema:'ulpin-scoped-client-export/1',scope:{kind:scope?records[0].kind:'building',id:scope||dossier.canonicalBuildingId},preview,
  building:{id:dossier.canonicalBuildingId,identifier:dossier.building.identifier,name:dossier.building.name,revision:dossier.building.revision,world:dossier.building.worldStatus,...(includes.geometry?{geometry:dossier.building.geometry,geographicGeometry:dossier.building.geographicGeometry,height:dossier.building.height}:{})},
  records:records.map(r=>({id:r.id,identifier:r.identifier,name:r.name,kind:r.kind,use:r.use,revision:r.revision,synthetic:r.synthetic,links:r.links,...(includes.geometry?{geometry:r.geometry,footprint:r.footprint}:{}),...(includes.evidence?{evidence:r.evidence,rights:r.rights}:{})})),
  ...(includes.geometry?{placedDetails:dossier.detailedScene.filter(d=>ids.has(d.record.id))}:{}),
  ...(includes.evidence?{sources:dossier.sources,parcelIdentifiers:dossier.parcelIdentifiers}:{}),
  ...(includes.findings?{buildingContextFindings:dossier.issues,check:dossier.check}:{}),
  ...(includes.history?{sourceEvents:dossier.sources.map(s=>({sourceId:s.id,revision:s.revision,createdAt:s.createdAt})),associationEvents:dossier.associations,investigationDecisions:dossier.investigations,physicalHistoryUrl:`/api/v1/physical-features/${dossier.canonicalBuildingId}/revisions`}:{}),
  notice:'Findings and shared original files retain building context. Scope does not partition a multi-page original. Technical evidence is not an issued title.'};}
 const features=scope?context!.features.filter(f=>f.id===scope):context!.features,ids=new Set(features.map(f=>f.id));
 return {schema:'ulpin-scoped-client-export/1',scope:{kind:scope?'feature':'dataset',id:scope||context!.area.id},preview,area:context!.area,features:features.map(f=>includes.geometry?f:{id:f.id,identifier:f.identifier,kind:f.kind,name:f.name,revision:f.revision,worldStatus:f.worldStatus,sourceRevisionId:f.sourceRevisionId}),...(includes.evidence?{sources:[...new Set(features.map(f=>f.sourceRevisionId))].map(id=>({id,url:`/api/v1/sources/${id}/file`}))}:{}),...(includes.findings?{check:context!.latestCheck?{...context!.latestCheck,findings:context!.latestCheck.findings.filter(f=>f.featureIds.some(id=>ids.has(id)))}:null}:{}),...(includes.history?{packages:context!.packages.filter(p=>p.features.some(f=>ids.has(f.id))).map(p=>({id:p.id,revision:p.revision,state:p.state,createdAt:p.createdAt,sourceRevisionIds:p.sourceRevisionIds}))}:{}),notice:'Source worlds remain distinguished; original geometry is not moved or inferred. Overlapping finding areas are not summed.'};
}
