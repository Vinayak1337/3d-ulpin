'use client';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import type {ImportPackage} from '@ulpin/contracts';
import {useMutation,useResource} from '../shared/hooks';
import {ErrorState,LoadingState} from '../shared/ui';
import ImportReview from '../block/ImportReview';
import '../block/data-tools.css';
import './work.css';
export default function ImportWork({packageId}:{packageId:string}){
 const resource=useResource<ImportPackage>(`/import-packages/${packageId}`), mutation=useMutation(),router=useRouter();
 return <main className="work-queue import-work"><Link href="/studio/work">← Work queue</Link><header className="work-heading"><div><h1>Review boundaries</h1><p>Check the saved source details before recording the geometry.</p></div></header>{resource.loading?<LoadingState label="Opening saved source"/>:resource.error?<ErrorState message={resource.error} retry={resource.reload}/>:resource.data&&<section className="work-list">{mutation.error&&<ErrorState message={mutation.error}/>}<ImportReview pkg={resource.data} busy={mutation.busy} onUpdate={operation=>{void mutation.run(async()=>{await operation();await resource.reload();});}} onCommitted={pkg=>router.push(`/studio/areas/${pkg.areaId}`)}/></section>}</main>;
}
