import {notFound} from 'next/navigation';
import DatasetProcessing from '@/features/spatial/dataset-processing/DatasetProcessing';
export const metadata={title:'3D ULPIN · ML extraction'};
export default async function Page({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{run?:string;view?:string}>}){const {id}=await params;const {run,view}=await searchParams;if(!/^[0-9a-f-]{36}$/i.test(id))notFound();return <DatasetProcessing id={id} initialRun={run} initialStage={view==='sources'||view==='explain'?view:'review'}/>;}
