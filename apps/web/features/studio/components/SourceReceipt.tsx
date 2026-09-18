import {CheckCircle,Download,FileText} from 'lucide-react';
import {useStudioSources,downloadPreparedAsset} from '../data/useSources';
export default function SourceReceipt({buildingId}:{buildingId:string}){
 const sources=useStudioSources();
 if(sources.error)return <p className="ins-note" role="alert">Prepared source receipts are unavailable. No replacement documents were generated.</p>;
 if(!sources.data)return <p className="ins-note" role="status">Loading prepared source receipts…</p>;
 const docs=sources.data.documents.filter(d=>d.buildingId===buildingId);
 return <section className="studio-source-receipts"><div><CheckCircle size={16}/><strong>{docs.length} prepared documents</strong></div><p>Original bytes are checked on download. Linked to the normalized synthetic snapshot.</p><code title={sources.data.coreInputDigest}>Snapshot {sources.data.coreInputDigest.slice(0,16)}…</code>{docs.filter(d=>d.kind==='land'||d.kind==='register').map(d=><button key={d.id} onClick={()=>void downloadPreparedAsset('/api/v1/studio/sources/documents/'+encodeURIComponent(d.id),d.filename,d.sha256)}><FileText size={14}/><span>{d.kind==='land'?'Parcel specimen':'Floor & unit register'}<small>SHA-256 {d.sha256.slice(0,10)}…</small></span><Download size={14}/></button>)}</section>;
}
