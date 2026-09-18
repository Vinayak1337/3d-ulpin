import {z} from 'zod';
import {metricTopologyIssue} from '@ulpin/contracts';
export const StudioDraftSchema=z.strictObject({schemaVersion:z.literal('studio-local-draft/1'),buildingId:z.string().regex(/^BLD-\d{4}$/),revision:z.number().int().nonnegative(),sourceHash:z.string().regex(/^[a-f0-9]{64}$/),floor:z.number().int().min(0).max(99),unitId:z.string().nullable(),tool:z.enum(['distance','area','perimeter']),points:z.array(z.tuple([z.number(),z.number()])).max(256),calibration:z.number().positive().max(100),notes:z.string().max(4000),status:z.enum(['draft','ready_for_review']),updatedAt:z.string()});
export type StudioDraft=z.infer<typeof StudioDraftSchema>;
export const studioDraftKey=(id:string,floor:number)=>`ulpin:studio-local-draft:v2:${id}:F${floor}`;
export function loadStudioDraft(storage:Pick<Storage,'getItem'>,id:string,floor:number):StudioDraft|null {
 const current=storage.getItem(studioDraftKey(id,floor));
 const raw=current??storage.getItem('ulpin:studio-local-draft:v1:'+id);
 if(!raw)return null;
 if(raw.length>64000)throw new Error('Stored draft exceeds its profile');
 const d=StudioDraftSchema.parse(JSON.parse(raw));
 if(d.buildingId!==id)throw new Error('Draft belongs to another property');
 if(d.floor!==floor){if(current)throw new Error('Stored draft belongs to another floor');return null;}
 return d;
}
export function saveStudioDraft(storage:Pick<Storage,'getItem'|'setItem'>,input:StudioDraft){
 const d=StudioDraftSchema.parse(input),old=loadStudioDraft(storage,d.buildingId,d.floor);
 if((old?.revision??0)!==d.revision)throw new Error('This draft changed in another tab. Reload before saving.');
 if(old&&old.sourceHash!==d.sourceHash)throw new Error('This draft belongs to a different source revision. The saved original has not been overwritten.');
 if(d.unitId&&!new RegExp(`^${d.buildingId}/F${d.floor}/U[1-9][0-9]*$`).test(d.unitId))throw new Error('The selected unit does not belong to this draft floor.');
 if(d.status==='ready_for_review'&&d.points.length&&!studioMeasurement(d.points,d.tool,d.calibration))throw new Error('Complete or clear the unfinished measurement before review.');
 const next=StudioDraftSchema.parse({...d,revision:d.revision+1,updatedAt:new Date().toISOString()});
 storage.setItem(studioDraftKey(d.buildingId,d.floor),JSON.stringify(next));
 return next;
}
/** Local source-coordinate measurements, independent of the canvas or renderer. */
export function studioMeasurement(points:readonly (readonly [number,number])[],tool:StudioDraft['tool'],calibration=1){
 if(!Number.isFinite(calibration)||calibration<=0||points.some(p=>p.length!==2||!p.every(Number.isFinite)))throw new Error('Invalid measurement input');
 let value=0;
 if(tool==='area'){if(points.length<3)return null;const ring=points.map(p=>[p[0],p[1]] as [number,number]);if(ring[0][0]!==ring.at(-1)![0]||ring[0][1]!==ring.at(-1)![1])ring.push([...ring[0]]);const invalid=metricTopologyIssue({type:'Polygon',coordinates:[ring]});if(invalid)throw new Error('The draft boundary crosses or repeats itself. Clear it and select an ordered boundary.');for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length];value+=a[0]*b[1]-b[0]*a[1];}value=Math.abs(value/2)*calibration**2;if(value<1e-9)throw new Error('The selected points do not enclose a measurable area.');}
 else{if(points.length<2)return null;for(let i=1;i<points.length;i++)value+=Math.hypot(points[i][0]-points[i-1][0],points[i][1]-points[i-1][1]);if(tool==='perimeter'&&points.length>2)value+=Math.hypot(points.at(-1)![0]-points[0][0],points.at(-1)![1]-points[0][1]);value*=calibration;}
 if(!Number.isFinite(value))throw new Error('Measurement overflow');return {value,unit:tool==='area'?'m²':'m'};
}
