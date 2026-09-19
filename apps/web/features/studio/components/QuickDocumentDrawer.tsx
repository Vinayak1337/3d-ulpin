import {ArrowUpRight,X,FileText} from 'lucide-react';
import type {Building,RecordContext} from '../types';
import type {PreparedKind} from '../data/source-types';
import {documentTitles} from '../data/documents';
import {useDialog} from './useDialog';
import PreparedDocumentViewer from './PreparedDocumentViewer';

export default function QuickDocumentDrawer({building:b,context,onClose,onFull}:{building:Building;context:RecordContext;onClose:()=>void;onFull:()=>void}){
 const ref=useDialog(onClose),kind=context.doc??'land';
 return <div className="quick-document-shade" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}><section ref={ref} tabIndex={-1} className="quick-document-drawer" role="dialog" aria-modal="true" aria-labelledby="quick-doc-title"><header><FileText size={20}/><div><h2 id="quick-doc-title">{documentTitles[kind]}</h2><p>{b.name} | quick inspection</p></div><button onClick={onFull}>Full register <ArrowUpRight size={14}/></button><button onClick={onClose} aria-label="Close quick document"><X size={20}/></button></header><PreparedDocumentViewer buildingId={b.id} kind={kind as PreparedKind} unitId={context.unitId??b.units.find(u=>u.floor===(context.floor??0))?.id} floor={context.floor??0} compact/></section></div>;
}
