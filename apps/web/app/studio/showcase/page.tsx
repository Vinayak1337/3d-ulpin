import {listSpatialDatasets} from '@/lib/server/spatial-datasets';
import {notFound,redirect} from 'next/navigation';
import {demoDataset} from '@/features/spatial/reference-workbench/demo-datasets';
import ReferenceWorkbench from '@/features/spatial/reference-workbench/ReferenceWorkbench';
export const metadata={title:'3D ULPIN · Block Map',description:'Source-preserving canonical neighbourhood preview.'};
export default async function ShowcasePage({searchParams}:{searchParams:Promise<{dataset?:string;saved?:string}>}){const {dataset,saved}=await searchParams;if(saved&&!/^[0-9a-f-]{36}$/i.test(saved))notFound();if(dataset&&!demoDataset(dataset))notFound();if(dataset&&!saved){const match=(await listSpatialDatasets()).find(d=>d.sha256===demoDataset(dataset)?.sha256);if(match)redirect(`/studio/showcase?saved=${match.id}`);}return <ReferenceWorkbench key={saved??dataset??'active'} datasetId={dataset} savedId={saved}/>;}
