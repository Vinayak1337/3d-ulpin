export interface ReferenceIdentifier { value:string; scheme:string; status:string; issuer:string|null; synthetic:boolean }
export interface ReferenceIdentity { objectId:string; threeDId:string|null; twoDIds:ReferenceIdentifier[]; primary:string; label:string; classification:string; synthetic:boolean; internal:boolean; assertions:any[] }
export interface ReferenceResident { id:string|null; name:string; role:string; classification:string; objectId:string; floorId:string|null; unitId:string|null; sourceRecordId:string|null; [key:string]:unknown }
export interface ReferenceSearchResult { buildingId:string; floorId?:string; objectId:string; label:string; identifier:string; matchedBy:string }
export interface SceneRecords {
 identity(objectId:string):ReferenceIdentity|null;
 building(objectId:string):{object:any;identity:ReferenceIdentity|null;floors:any[];parcels:any[];residents:ReferenceResident[]}|null;
 floors(buildingId:string):any[];
 parcels(objectId:string):any[];
 residents(objectId:string):ReferenceResident[];
 search(query:string):ReferenceSearchResult[];
 owner(objectId:string):any|null;
 floorOwner(objectId:string):any|null;
}
export function createSceneRecords(scene:unknown):SceneRecords;
