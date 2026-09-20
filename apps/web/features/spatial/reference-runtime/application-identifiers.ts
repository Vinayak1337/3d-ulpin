import {createSceneRecords} from './records';

export interface ApplicationIdentifier {
 objectId:string; buildingId:string; floorId:string|null; identifier:string;
 label:string; aliases:string[]; twoDIds:string[]; method:'application-3d-v1';
}
type Scene={objects: {id:string;type:string;label?:string;attributes?:Record<string,unknown>}[]};
const alphabet='0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const isSourceUlpIn=(value:string)=>/^[A-Za-z0-9]{14}$/.test(value);

/** Record identity allocation, not official geographic ULPIN issuance.
 * The receipt namespace prevents unrelated imports with the same source IDs colliding.
 * Geometry revisions do not change an assignment. Cross-package reconciliation is explicit.
 */
export async function assignApplicationIdentifiers(scene:Scene,namespace:string):Promise<ApplicationIdentifier[]> {
 if(!namespace)throw new Error('An immutable source receipt namespace is required.');
 const records=createSceneRecords(scene),result:ApplicationIdentifier[]=[],used=new Set<string>(),assignedObjects=new Set<string>();
 for(const building of scene.objects.filter(o=>['building','building_part'].includes(o.type))){
  const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(['application-3d-v1',namespace,building.id]))));
  let bits=0,buffer=0,token='';
  for(const byte of bytes){buffer=(buffer<<8)|byte;bits+=8;while(bits>=5&&token.length<14){bits-=5;token+=alphabet[(buffer>>>bits)&31];}if(token.length===14)break;}
  const base=`3D-${token}`;
  const push=(object:Scene['objects'][number],identifier:string,floorId:string|null)=>{
   if(assignedObjects.has(object.id))throw new Error(`Ambiguous building parent for ${object.id}. Review source relationships.`);
   assignedObjects.add(object.id);
   if(used.has(identifier))throw new Error(`Ambiguous 3D identity for ${object.id}. Review duplicate floor levels or source identities.`);
   used.add(identifier);
   const identity=records.identity(object.id);
   result.push({objectId:object.id,buildingId:building.id,floorId,identifier,label:object.label||object.id,
    aliases:[...new Set([object.id,identity?.threeDId,...(identity?.assertions??[]).map(a=>a.value),...(!floorId?(records.identity(building.id)?.twoDIds??[]).map(a=>a.value):[])].filter((x):x is string=>typeof x==='string'&&!!x))],
    twoDIds:(records.identity(building.id)?.twoDIds??[]).filter(a=>isSourceUlpIn(a.value)).map(a=>a.value),method:'application-3d-v1'});
  };
  push(building,base,null);
  for(const floor of records.floors(building.id)){
   const level=floor.attributes?.level??floor.attributes?.floor_level;
   // Floor ordinals cannot be invented from array position, label or estimated height.
   if(typeof level!=='number'||!Number.isSafeInteger(level))continue;
   push(floor,`${base}:${level}`,floor.id);
  }
 }
 return result;
}

/** Separate registry projection: originals, assertions and snapshot digest remain intact. */
export function withApplicationIdentifiers<T extends Scene>(scene:T,assignments:ApplicationIdentifier[]):T {
 const byId=new Map(assignments.map(a=>[a.objectId,a]));
 return {...scene,objects:scene.objects.map(object=>{const assignment=byId.get(object.id);return assignment?{...object,attributes:{...object.attributes,application3dId:assignment.identifier,application3dMethod:assignment.method,identifierAliases:assignment.aliases}}:object;})};
}
