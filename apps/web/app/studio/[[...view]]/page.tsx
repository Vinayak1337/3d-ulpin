import { withRouteQuery, type RouteSearchParams } from '@/lib/legacy-url';
import { studioResolutionUrl } from '@/features/studio/product/urls';
import WorkQueue from '@/features/officer/work/WorkQueue';
import ImportWork from '@/features/officer/work/ImportWork';
import {Suspense,type ReactNode} from 'react';
import {notFound,redirect} from 'next/navigation';
import Shell from '@/features/officer/shared/Shell';
import BlockHome from '@/features/officer/block/BlockHome';
import BlockPage from '@/features/officer/block/BlockPage';
import RegisterStart from '@/features/officer/register/RegisterStart';
import RegisterPage from '@/features/officer/register/RegisterPage';
import AddFiles from '@/features/officer/workspace/AddFiles';
import WorkspaceStart from '@/features/officer/workspace/WorkspaceStart';
import WorkspacePage from '@/features/officer/workspace/WorkspacePage';
import GeometryWorkspace from '@/features/officer/workspace/GeometryWorkspace';
import RetainedRegister from '@/features/officer/register/RetainedRegister';
import DelhiStudy from '@/features/officer/delhi/DelhiStudy';
import {query} from '@/lib/server/db';
import {resolveRecord} from '@/lib/server/registry';
import {resolveAreaIdentifier} from '@/lib/server/area-resolver';
import {searchTargets,searchTargetRoute,type ResolveMatch} from '@/features/officer/shared/search-targets';
export const metadata={title:'3D ULPIN · City Studio',description:'Connected building, parcel, floor and evidence workbench.'};
const uuid=(value:string)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export default async function StudioPage({params,searchParams}:{params:Promise<{view?:string[]}>;searchParams:Promise<RouteSearchParams>}){
 const p=(await params).view??[];let page:ReactNode;
 if(!p.length)redirect(withRouteQuery('/studio/work',await searchParams));
 if(p.length===1&&p[0]==='work')page=<WorkQueue/>;
 else if(p.length===2&&p[0]==='imports'&&uuid(p[1]))page=<ImportWork packageId={p[1]}/>;
 else if(p.length===1&&p[0]==='datasets')page=<BlockHome/>;
 else if(p.length===1&&p[0]==='registry')page=<RegisterStart/>;
 else if(p.length===1&&p[0]==='add-files')page=<AddFiles/>;
 else if(p.length===1&&p[0]==='workspaces')page=<WorkspaceStart/>;
 else if(p.length===1&&p[0]==='source-study')page=<DelhiStudy/>;
 else if(p.length===2&&p[0]==='areas'&&uuid(p[1]))page=<BlockPage key={p[1]} areaId={p[1]}/>;
 else if(p.length===3&&p[0]==='properties'&&uuid(p[1])&&p[2]==='register')page=<RegisterPage key={p[1]} buildingId={p[1]}/>;
 else if(p.length===3&&p[0]==='properties'&&uuid(p[1])&&['workspace','prepare'].includes(p[2]))page=<WorkspacePage key={p[1]} buildingId={p[1]}/>;
 else if(p.length===2&&p[0]==='cases'&&uuid(p[1])){
  const binding=await query('SELECT building_id FROM building_preparations WHERE case_id::text=$1',[p[1]]);
  page=<WorkspacePage key={p[1]} caseId={p[1]} buildingId={binding.rows[0]?.building_id}/>;
 }else if(p.length===3&&p[0]==='cases'&&uuid(p[1])&&p[2]==='geometry')page=<GeometryWorkspace key={p[1]} caseId={p[1]}/>;
 else if(p.length===3&&p[0]==='registry'&&p[1]==='sites'&&uuid(p[2]))page=<RetainedRegister key={p[2]} siteId={p[2]}/>;
 else if(p.length===3&&p[0]==='registry'&&p[1]==='records'){
  const matches=await resolveAreaIdentifier(p[2]);
  const targets=[...new Map(matches.matches.flatMap(m=>searchTargets(m as unknown as ResolveMatch)).filter(t=>t.kind==='building').map(t=>[t.id,t])).values()];
  if(targets.length===1)redirect(studioResolutionUrl(searchTargetRoute(targets[0],'register'),await searchParams));
  if(targets.length>1)page=<RegisterStart identifier={p[2]}/>;
  else {const {record,site}=await resolveRecord(p[2]);page=<RetainedRegister key={record.id} siteId={site.id} recordId={record.id}/>;}
 }else if(['areas','properties','cases','registry','datasets','workspaces','work','imports','add-files'].includes(p[0]))notFound();
 else if(['map','register','workspace'].includes(p[0]))redirect(p[0]==='map'?'/studio/datasets':p[0]==='register'?'/studio/registry':'/studio/work');
 else notFound();
 return <Suspense fallback={<p>Opening City Studio…</p>}><Shell>{page}</Shell></Suspense>;
}
