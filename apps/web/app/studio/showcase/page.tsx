import {notFound,redirect} from 'next/navigation';
import ReferenceWorkbench from '@/features/spatial/reference-workbench/ReferenceWorkbench';
export const metadata={title:'3D ULPIN · Block Map',description:'Source-preserving canonical neighbourhood preview.'};
export default async function ShowcasePage({searchParams}:{searchParams:Promise<{dataset?:string;saved?:string}>}){const {dataset,saved}=await searchParams;if(saved&&!/^[0-9a-f-]{36}$/i.test(saved))notFound();if(dataset&&!saved)redirect('/studio/showcase');return <ReferenceWorkbench key={saved??'unselected'} savedId={saved}/>;}
