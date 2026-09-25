import {listSpatialDatasets} from '@/lib/server/spatial-datasets';
import {notFound,redirect} from 'next/navigation';
import {demoDataset} from '@/features/spatial/reference-workbench/demo-datasets';
import ReferenceWorkbench from '@/features/spatial/reference-workbench/ReferenceWorkbench';
export const metadata={title:'3D ULPIN · Block Map',description:'Source-preserving canonical neighbourhood preview.'};
export default async function ShowcasePage({searchParams}:{searchParams:Promise<{dataset?:string;saved?:string;import?:string}>}){const {dataset,saved,import:importRequested}=await searchParams;if(saved&&!/^[0-9a-f-]{36}$/i.test(saved))notFound();if(!saved&&dataset){const legacy=demoDataset(dataset);if(legacy){const match=(await listSpatialDatasets()).find(d=>d.sha256===legacy.sha256);if(match)redirect(`/studio/showcase?saved=${match.id}`);}redirect('/studio/datasets');}if(!saved)redirect(importRequested?'/studio/add-files':'/studio/datasets');return <ReferenceWorkbench key={saved} savedId={saved}/>;}
