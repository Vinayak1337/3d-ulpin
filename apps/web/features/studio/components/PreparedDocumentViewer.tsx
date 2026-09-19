import {useMemo} from 'react';
import {FileText,Download,ShieldCheck} from 'lucide-react';
import OriginalDocument from '../../officer/documents/OriginalDocument';
import {useStudioSources,downloadPreparedAsset} from '../data/useSources';
import {preparedDocumentId,type PreparedKind} from '../data/source-types';

export default function PreparedDocumentViewer({buildingId,kind,unitId,floor=0,compact=false}:{buildingId:string;kind:PreparedKind;unitId?:string;floor?:number;compact?:boolean}){
 const resource=useStudioSources();
 const document=resource.data?.documents.find(d=>d.id===preparedDocumentId(kind,buildingId,unitId,floor));
 const source=useMemo(()=>document?{id:document.id,name:document.filename,hash:document.sha256,url:'/api/v1/studio/sources/documents/'+encodeURIComponent(document.id),kind:'pdf' as const,parts:[]}:undefined,[document]);
 if(resource.error)return <p role="alert" className="quick-warning">{resource.error}</p>;
 if(!resource.data)return <p role="status">Loading retained source receipt…</p>;
 if(!document||!source)return <p role="alert" className="quick-warning">No prepared original matches this exact property, floor and document. A substitute was not generated.</p>;
 return <div className="prepared-original" data-prepared-document={document.id}><div className="prepared-original-receipt"><FileText size={18}/><span><strong>{document.filename}</strong><small>{document.pages} page{document.pages===1?'':'s'} · {(document.bytes/1024).toFixed(1)} KB · prepared synthetic original</small></span><button onClick={()=>void downloadPreparedAsset(source.url,document.filename,document.sha256)} aria-label="Download exact prepared original"><Download size={17}/></button></div><OriginalDocument source={source} compact={compact}/><div className="prepared-original-hash"><ShieldCheck size={13}/><span>Registered SHA-256</span><code>{document.sha256}</code></div></div>;
}
