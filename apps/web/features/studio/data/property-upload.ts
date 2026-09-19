import type {BuildingDossier,CaseDetail,ImportPackage,PreparationCase} from '@ulpin/contracts';
import type {PropertyChoice} from '../../officer/shared/PropertySearch';
export const originalChecksum=async(bytes:ArrayBuffer)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(v=>v.toString(16).padStart(2,'0')).join('');
async function json<T>(url:string,init?:RequestInit):Promise<T>{const response=await fetch('/api/v1'+url,{...init,cache:'no-store'}),data=await response.json();if(!response.ok)throw new Error(data.error?.message??data.error??'Source operation failed');return data;}
/** Uses the existing preparation writer. The UI cannot declare a document linked
 * until its checksum and entity association are visible in the returned package. */
export async function uploadLinkedOriginal(property:PropertyChoice,file:File,requestKey:string){
 const format=file.name.toLowerCase().split('.').at(-1)?.replace(/^jpg$/,'jpeg').replace(/^txt$/,'text');
 if(!format||!['pdf','png','jpeg','csv','docx','text'].includes(format))throw new Error('Linked documents support PDF, PNG/JPEG, CSV, DOCX or text. Import geographic boundaries through the GIS workflow.');
 const hash=await originalChecksum(await file.arrayBuffer());
 const dossier=await json<BuildingDossier>(`/buildings/${encodeURIComponent(property.buildingId)}/dossier`);
 if(dossier.canonicalBuildingId!==property.buildingId)throw new Error('The returned property identity does not match the destination.');
 const prep=dossier.preparations[0]??await json<PreparationCase>(`/buildings/${property.buildingId}/preparation-cases`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedRevision:dossier.building.revision,requestKey})});
 let pkg=await json<ImportPackage>(`/import-packages/${prep.packageId}`),detail=await json<CaseDetail>(`/cases/${prep.caseId}`);
 const prior=detail.sources.find(s=>s.sha256===hash&&s.name===file.name&&pkg.parts.some(p=>p.sourceRevisionId===s.id&&p.entityIds.includes(property.buildingId)));
 if(prior)return {source:prior,caseId:prep.caseId,packageId:pkg.id,property,reused:true};
 const form=new FormData();form.set('file',file);form.set('format',format);form.set('entityIds',JSON.stringify([property.buildingId]));form.set('expectedRevision',String(pkg.revision));
 pkg=await json<ImportPackage>(`/import-packages/${pkg.id}/documents`,{method:'POST',headers:{'Idempotency-Key':requestKey},body:form});
 detail=await json<CaseDetail>(`/cases/${prep.caseId}`);
 const sources=detail.sources.filter(s=>s.sha256===hash&&s.name===file.name&&pkg.sourceRevisionIds.includes(s.id));
 const source=sources.find(s=>pkg.parts.some(p=>p.sourceRevisionId===s.id&&p.entityIds.includes(property.buildingId)));
 if(!source||source.bytes!==file.size)throw new Error('Original received but its property association could not be verified. Inspect the existing workspace before retrying.');
 return {source,caseId:prep.caseId,packageId:pkg.id,property,reused:false};
}
