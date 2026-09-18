import type {District,InspectorTab,RecordContext} from './types';

export const studioViews=['map','register','documents','workspace','import','overview','export','help'] as const;
export type StudioView=typeof studioViews[number];
export interface StudioRoute {
  view:StudioView;property:string|null;tab:InspectorTab;mode:'2d'|'3d';
  floor:number|null;unit:string|null;doc:RecordContext['doc']|null;exploded:boolean;
  error:string|null;
}
export function readStudioRoute(value:string,dataset:District):StudioRoute {
  const route:StudioRoute={view:'map',property:dataset.defaultBuildingId,tab:'overview',mode:'3d',floor:null,unit:null,doc:null,exploded:false,error:null};
  try{
    const url=new URL(value,'http://localhost'),path=url.pathname.split('/').filter(Boolean);
    if(path[0]!=='studio'||path.length>3)throw new Error('This Studio route does not exist.');
    const view=path[1]??'map';if(!studioViews.includes(view as StudioView))throw new Error('This Studio view does not exist.');route.view=view as StudioView;
    if(path[2])route.property=decodeURIComponent(path[2]);
    const selection=url.searchParams.get('selection');
    if(selection!==null&&selection!=='none')throw new Error('Unknown selection state.');
    if(selection==='none')route.property=null;
    const allowed=new Set(['tab','mode','floor','unit','doc','explode','selection']);
    for(const key of url.searchParams.keys())if(!allowed.has(key)||url.searchParams.getAll(key).length!==1)throw new Error('The Studio route has an unsupported or repeated parameter.');
    const tab=url.searchParams.get('tab');if(tab&&!['overview','parcel','floors','evidence','utilities'].includes(tab))throw new Error('This inspector tab does not exist.');if(tab)route.tab=tab as InspectorTab;
    const mode=url.searchParams.get('mode');if(mode&&mode!=='2d'&&mode!=='3d')throw new Error('Unknown map mode.');if(mode==='2d'||mode==='3d')route.mode=mode;
    const floor=url.searchParams.get('floor');if(floor!==null){if(!/^(0|[1-9][0-9]?)$/.test(floor))throw new Error('Invalid floor reference.');route.floor=Number(floor);}
    const doc=url.searchParams.get('doc');if(doc&&!['land','lease','plan','aerial','register'].includes(doc))throw new Error('Unknown document type.');if(doc)route.doc=doc as RecordContext['doc'];
    const explode=url.searchParams.get('explode');if(explode!==null&&explode!=='0'&&explode!=='1')throw new Error('Unknown exploded-floor state.');
    for(const key of ['mode','tab','doc','unit'])if(url.searchParams.has(key)&&!url.searchParams.get(key))throw new Error('The route contains an empty record parameter.');
    route.exploded=explode==='1';route.unit=url.searchParams.get('unit');
    const building=route.property?dataset.buildings.find(b=>b.id===route.property||b.ulpin===route.property):null;
    if(route.property&&!building)throw new Error('The requested property is not in this dataset. No other property was substituted.');
    if(building)route.property=building.id;
    if(route.floor!==null&&(!building||route.floor>=building.floors))throw new Error('The requested floor does not belong to this property.');
    if(route.unit){const unit=building?.units.find(u=>u.id===route.unit);if(!unit)throw new Error('The requested unit does not belong to this property.');if(route.floor!==null&&unit.floor!==route.floor)throw new Error('The requested unit and floor disagree.');route.floor=unit.floor;}
    if(['register','documents','workspace'].includes(route.view)&&!building)throw new Error('Choose a property before opening its records.');
  }catch(error){route.error=error instanceof Error?error.message:'Invalid Studio route.';}
  return route;
}
export function studioUrl(route:Partial<StudioRoute>):string {
  const view=route.view??'map',property=route.property;
  const query=new URLSearchParams();
  if(property===null)query.set('selection','none');
  if(route.tab&&route.tab!=='overview')query.set('tab',route.tab);
  if(route.mode==='2d')query.set('mode','2d');
  if(route.floor!==null&&route.floor!==undefined)query.set('floor',String(route.floor));
  if(route.unit)query.set('unit',route.unit);
  if(route.doc)query.set('doc',route.doc);
  if(route.exploded)query.set('explode','1');
  return `/studio/${view}${property?`/${encodeURIComponent(property)}`:''}${query.size?'?'+query:''}`;
}
