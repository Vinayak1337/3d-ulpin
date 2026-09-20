export interface ReferenceRuntime {
 select(id:string,notify?:boolean,focus?:boolean):void;
 setPresentation?(mode:'block'|'building'|'exploded'|'elevation'|'section'):void;
 setMode(mode:'2d'|'3d'):void;
 getState():unknown;
 restoreState(state:unknown):void;
 getStats():Record<string,unknown>;
 dispose():void;
 setRailTab?(tab:'layers'|'properties'|'findings'):void;
 setInspectorOpen?(open:boolean):void;
 setRailOpen?(open:boolean):void;
 setFloor?(id:string):void;
 setLayer?(id:string,visible:boolean):void;
 fit?():void;
 focusSelected?():void;
}
export function mountMap(container:HTMLElement,data:unknown,options?:{onFloorSelect?:(id:string)=>void;onSelect?:(id:string)=>void;onRegister?:(id:string)=>void;onReview?:(id:string)=>void;onWorkspace?:(id:string)=>void;detail?:string}):ReferenceRuntime;
