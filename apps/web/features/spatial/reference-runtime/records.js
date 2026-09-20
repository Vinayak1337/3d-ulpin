/** Read-only record projection. IDs, floor records and people must already exist in the source. */
export function createSceneRecords(scene) {
  const list=value=>Array.isArray(value)?value:[];
  const text=value=>typeof value==='string'&&value.trim()?value.trim():null;
  const objects=list(scene?.objects),objectById=new Map(objects.map(o=>[o.id,o]));
  const geometryById=new Map(list(scene?.geometries).map(g=>[g.id,g]));
  const assertions=list(scene?.identifierAssertions);
  const twoDSchemes=new Set(['official_2d_ulpin','demo_2d_ulpin','2d_ulpin']);
  const threeDSchemes=new Set(['internal_3d','internal3dId','3d_ulpin','prototype_3d_ulpin']);
  const parentMap=new Map(),childMap=new Map();
  function edge(child,parent){if(!objectById.has(child)||!objectById.has(parent)||child===parent)return;const parents=parentMap.get(child)||new Set(),children=childMap.get(parent)||new Set();parents.add(parent);children.add(child);parentMap.set(child,parents);childMap.set(parent,children);}
  for(const r of list(scene?.relations)){
    if(r.kind==='contains'&&objectById.get(r.fromId)?.type!=='parcel')edge(r.toId,r.fromId);
    if(['part_of','occupies_level'].includes(r.kind))edge(r.fromId,r.toId);
  }
  for(const o of objects)for(const parent of [o.parentId,o.attributes?.parentId,o.attributes?.parent_id,o.attributes?.buildingId,o.attributes?.building_id,o.attributes?.floorId,o.attributes?.floor_id])if(text(parent))edge(o.id,parent);
  const isBuilding=o=>['building','building_part'].includes(o?.type);
  const isFloor=o=>['floor','level'].includes(o?.type);
  function ancestors(id){const found=[],visited=new Set([id]),queue=[...(parentMap.get(id)||[])];while(queue.length){const next=queue.shift();if(visited.has(next))continue;visited.add(next);found.push(objectById.get(next));queue.push(...(parentMap.get(next)||[]));}return found;}
  function descendants(id){const found=[],visited=new Set([id]),queue=[...(childMap.get(id)||[])];while(queue.length){const next=queue.shift();if(visited.has(next))continue;visited.add(next);found.push(objectById.get(next));queue.push(...(childMap.get(next)||[]));}return found;}
  function owner(id){const o=objectById.get(id);return isBuilding(o)?o:ancestors(id).find(isBuilding)||null;}
  function floorOwner(id){const o=objectById.get(id);return isFloor(o)?o:ancestors(id).find(isFloor)||null;}
  function ownAssertions(id){return assertions.filter(a=>a.objectId===id&&text(a.value)&&!['unavailable','rejected','withdrawn'].includes(a.status));}
  function ownTwoD(id){
    const o=objectById.get(id),found=ownAssertions(id).filter(a=>twoDSchemes.has(a.scheme)).map(a=>({value:a.value,scheme:a.scheme,status:a.status||'reported',issuer:a.issuer||null,synthetic:['fictional','synthetic','prototype'].includes(a.status)||scene?.metadata?.classification==='synthetic'}));
    const authored=text(o?.attributes?.parcel2dDemoId);if(authored&&!found.some(a=>a.value===authored))found.push({value:authored,scheme:'2d_ulpin',status:'fictional',issuer:null,synthetic:true});
    return found;
  }
  function parcels(id){
    const building=owner(id),target=building?.id||id;
    if(objectById.get(id)?.type==='parcel')return [objectById.get(id)];
    const result=new Set();
    for(const r of list(scene?.relations)){
      if(r.kind==='contains'&&r.toId===target&&objectById.get(r.fromId)?.type==='parcel')result.add(r.fromId);
      if(['occupies','associated_parcel'].includes(r.kind)&&r.fromId===target&&objectById.get(r.toId)?.type==='parcel')result.add(r.toId);
    }
    for(const value of [objectById.get(target)?.attributes?.parcelId,objectById.get(target)?.attributes?.parcel_id])if(objectById.get(value)?.type==='parcel')result.add(value);
    return [...result].map(id=>objectById.get(id));
  }
  const identityCache=new Map();
  function identity(id){
    if(identityCache.has(id))return identityCache.get(id);
    const object=objectById.get(id);if(!object)return null;
    const supplied=ownAssertions(id),asserted=supplied.find(a=>threeDSchemes.has(a.scheme));
    const threeDId=text(asserted?.value)||text(object.attributes?.internal3dId)||text(object.systemId);
    const twoDIds=[...ownTwoD(id),...parcels(id).filter(p=>p.id!==id).flatMap(p=>ownTwoD(p.id))].filter((a,i,all)=>all.findIndex(b=>b.value===a.value)===i);
    const classification=object.classification||object.attributes?.classification||scene?.metadata?.classification||'unknown';
    const value={objectId:id,threeDId,twoDIds,primary:threeDId||id,label:object.label||id,classification,synthetic:classification==='synthetic'||['fictional','synthetic','prototype'].includes(asserted?.status),internal:Boolean(threeDId),assertions:supplied};identityCache.set(id,value);return value;
  }
  function floors(id){return descendants(id).filter(isFloor).sort((a,b)=>{const az=geometryById.get(a.geometryId)?.baseElevationM,bz=geometryById.get(b.geometryId)?.baseElevationM;return Number.isFinite(az)&&Number.isFinite(bz)?az-bz:0;});}
  function residents(id){
    const scopes=[objectById.get(id),...descendants(id)].filter(Boolean),found=[];
    for(const object of scopes){
      const occupants=list(object.attributes?.occupants).length?list(object.attributes.occupants):list(object.attributes?.residents);
      for(const supplied of occupants){if(!supplied||!text(supplied.name))continue;const floor=floorOwner(object.id);found.push({...supplied,id:text(supplied.id),name:text(supplied.name),role:text(supplied.role)||'Unspecified role',classification:supplied.classification||object.classification||scene?.metadata?.classification||'unknown',objectId:object.id,floorId:floor?.id||null,unitId:['space','unit'].includes(object.type)?object.id:null,sourceRecordId:text(supplied.sourceRecordId)});}
    }
    return found;
  }
  function building(id){const object=owner(id);return object?{object,identity:identity(object.id),floors:floors(object.id),parcels:parcels(object.id),residents:residents(object.id)}:null;}
  function search(query){
    const q=String(query??'').trim().toLocaleLowerCase(),results=[],seen=new Set();
    const add=(object,matchedBy,identifier)=>{const b=owner(object.id);if(!b)return;const f=floorOwner(object.id),key=`${b.id}:${f?.id||''}:${object.id}`;if(seen.has(key))return;seen.add(key);results.push({buildingId:b.id,...(f?{floorId:f.id}:{}),objectId:object.id,label:object.label||object.id,identifier:identifier||identity(object.id)?.primary||object.id,matchedBy});};
    for(const object of objects){
      if(!isBuilding(object)&&!isFloor(object)&&!['space','unit'].includes(object.type))continue;
      const record=identity(object.id);
      if(!q){if(isBuilding(object))add(object,'building',record.primary);continue;}
      const ownMatch=[record.threeDId,object.id,object.label,object.attributes?.address].find(v=>typeof v==='string'&&v.toLocaleLowerCase().includes(q));
      if(ownMatch)add(object,isFloor(object)?'floor':isBuilding(object)?'building':'space',ownMatch);
      else if(isBuilding(object)){const twoD=record.twoDIds.find(a=>a.value.toLocaleLowerCase().includes(q));if(twoD)add(object,'parcel',twoD.value);}
    }
    return results.sort((a,b)=>Number(b.identifier.toLocaleLowerCase()===q)-Number(a.identifier.toLocaleLowerCase()===q));
  }
  return {identity,building,floors,parcels,residents,search,owner,floorOwner};
}
