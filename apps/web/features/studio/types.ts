export interface Rect { x:number; z:number; width:number; depth:number }
export interface Unit { id:string; number:string; floor:number; area:number; occupant:string; tenure:'Owner occupied'|'Rented'|'Vacant'; rent:number; leaseStart:string; leaseEnd:string; bedrooms:number }
export interface Building extends Rect { id:string; ulpin:string; parcelId:string; blockId:string; name:string; address:string; floors:number; floorHeight:number; height:number; use:'Residential'|'Mixed use'|'Commercial'; owner:string; parcel:Rect; color:string; roofColor:string; variant:number; units:Unit[]; registeredOn:string; surveyNumber:string }
export interface Park extends Rect { id:string; name:string }
export interface Road extends Rect { id:string; name:string; axis:'x'|'z'; widthMeters:number }
export interface Utility { id:string; kind:'Water'|'Sewer'|'Electric'; points:[number,number,number][]; diameter:number; depth:number; operator:string }
export interface Finding { id:string; buildingId:string; type:'Parcel'|'Road'|'Utility'; title:string; value:number; unit:'m²'|'m'; severity:'warning'|'critical'; description:string; geometry?:Rect }
export interface District { name:string; extent:number; blocks:(Rect & {id:string})[]; buildings:Building[]; parks:Park[]; roads:Road[]; utilities:Utility[]; defaultBuildingId:string; coordinateNote:string }
export interface Layers { buildings:boolean; parcels:boolean; roads:boolean; greenery:boolean; water:boolean; sewer:boolean; electric:boolean; findings:boolean; labels:boolean }
export type InspectorTab='overview'|'parcel'|'floors'|'evidence'|'utilities';
export type ModalKind='register'|'documents'|'workspace'|'import'|'aerial'|'export'|'help'|null;
export interface CameraCommand { type:'district'|'block'|'focus'|'north'|'zoomIn'|'zoomOut'|'2d'|'3d'; nonce:number }
export interface RecordContext { doc?:'land'|'lease'|'plan'|'aerial'|'register'; unitId?:string; floor?:number }
