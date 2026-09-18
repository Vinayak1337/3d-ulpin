export type PreparedKind='land'|'register'|'plan'|'lease'|'aerial';
export interface PreparedDocument {
 id:string;kind:PreparedKind;buildingId:string;unitId:string|null;floor:number|null;
 filename:string;sha256:string;bytes:number;pages:number;
}
export interface StudioSourceManifest {
 schemaVersion:'studio-prepared-sources/1';datasetVersion:string;synthetic:true;
 datasetSha256:string;coreInputDigest:string;coreGeometryDigest:string;
 counts:{buildings:number;parcels:number;floors:number;units:number;roads:number;utilities:number;findings:number;documents:number};
 documents:PreparedDocument[];
 assets:{id:string;file:string;sha256:string;bytes:number;mediaType:string}[];
}
export function preparedDocumentId(kind:PreparedKind,buildingId:string,unitId?:string,floor=0){
 return `${kind}-${buildingId}${kind==='plan'?`-F${floor}`:kind==='lease'&&unitId?'-'+unitId.split('/').slice(1).join('-'):''}`;
}
