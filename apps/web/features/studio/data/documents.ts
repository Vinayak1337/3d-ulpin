import { jsPDF } from 'jspdf';
import type { Building, Unit } from '../types';
import { district, computeFindings } from './district';
import { getFloorLayout, roomPalette } from './floorLayout';
import {preparedDocumentId} from './source-types';
export type DocumentType='land'|'lease'|'plan'|'aerial'|'register';
export const documentTitles:Record<DocumentType,string>={land:'Land record & parcel reference',lease:'Unit occupancy record',plan:'Floor plan & unit schedule',aerial:'District aerial-style overview',register:'Building & floor register'};
export const money=(n:number)=>new Intl.NumberFormat('en-IN',{maximumFractionDigits:0}).format(n);
export function documentFields(kind:DocumentType,b:Building,u?:Unit,floor=0):[string,string][] {
  const common:[string,string][]=[['Demo ULPIN',b.ulpin],['Parcel reference',b.parcelId],['Building',b.name],['Address',b.address]];
  if(kind==='land')return [...common,['Recorded owner (fictional)',b.owner],['Survey reference',b.surveyNumber],['Record date',b.registeredOn],['Land use',b.use],['Tenure','Freehold — synthetic fixture'],['Parcel area',`${(b.parcel.width*b.parcel.depth).toFixed(2)} m²`],['Building footprint',`${(b.width*b.depth).toFixed(2)} m²`],['Coordinate system','Local planar metres; north is −Z'],['Provenance','Procedurally generated inspection data']];
  if(kind==='lease'&&u)return [...common,['Unit reference',u.id],['Unit / floor',`${u.number} / ${u.floor===0?'Ground':`Floor ${u.floor}`}`],['Landlord (fictional)',b.owner],['Occupant (fictional)',u.occupant],['Occupancy type',u.tenure],['Unit area',`${u.area} m²`],['Monthly rent',u.rent?`Rs. ${money(u.rent)}`:'Not applicable'],['Illustrative deposit',u.rent?`Rs. ${money(u.rent*2)}`:'Not applicable'],['Lease start',u.tenure==='Rented'?u.leaseStart:'Not applicable'],['Lease end',u.tenure==='Rented'?u.leaseEnd:'Not applicable']];
  return [...common,['Floors',`${b.floors} (G+${b.floors-1})`],['Floor level',`${floor===0?'Ground':`Floor ${floor}`} / ${(floor*b.floorHeight).toFixed(1)} m`],['Units',String(b.units.length)],['Total gross floor area',`${(b.width*b.depth*b.floors).toFixed(2)} m²`],['Source','Generated from the same demo geometry as the 3D scene']];
}
export function createDocument(kind:DocumentType,b:Building,u?:Unit,floor=0):jsPDF {
  const doc=new jsPDF({orientation:kind==='aerial'?'landscape':'portrait',unit:'mm',format:'a4'});
  const width=doc.internal.pageSize.getWidth(),height=doc.internal.pageSize.getHeight();let y=0;
  doc.setCreationDate(new Date("2026-09-19T00:00:00Z"));doc.setProperties({title:`SYNTHETIC ${documentTitles[kind]} / ${b.id}`,author:"3D ULPIN Studio",subject:"Versioned fictional demonstration specimen"});
  const ascii=(s:string)=>s.replaceAll('m²','m2').replaceAll('−','-').replaceAll('—','-').replaceAll('·','/');
  const header=()=>{doc.setFillColor(40,88,73);doc.rect(0,0,width,4,'F');doc.setTextColor(40,88,73);doc.setFont('helvetica','bold');doc.setFontSize(19);doc.text('3D ULPIN / CITY STUDIO',17,19);doc.setFontSize(9);doc.setTextColor(158,89,38);doc.text('SYNTHETIC DEMO - NOT A LEGAL OR GOVERNMENT RECORD',17,27);doc.setTextColor(30,43,43);doc.setFontSize(16);doc.text(documentTitles[kind],17,41);doc.setFont('helvetica','normal');doc.setTextColor(100,112,110);doc.setFontSize(9);doc.text(`Reference ${b.ulpin} / ${b.id}`,17,49);y=59;};
  const footer=()=>{doc.setDrawColor(216,225,221);doc.line(17,height-16,width-17,height-16);doc.setFont('helvetica','normal');doc.setTextColor(112,123,119);doc.setFontSize(8);doc.text('Fictional people, identifiers, geometry and terms. Inspection use only. No signatures or legal validity.',17,height-11);doc.text(String(doc.getNumberOfPages()),width-19,height-11);};
  const ensure=(space:number)=>{if(y+space>height-23){footer();doc.addPage();header();}};
  header();
  if(kind==='aerial'){
    const size=132,ox=17,oy=58,extent=district.extent+20,half=extent/2,scale=size/extent;
    doc.setFillColor(113,124,118);doc.rect(ox,oy,size,size,'F');
    for(const block of district.blocks){doc.setFillColor(196,202,180);doc.rect(ox+(block.x-block.width/2+half)*scale,oy+(block.z-block.depth/2+half)*scale,block.width*scale,block.depth*scale,'F');}
    for(const p of district.parks){doc.setFillColor(133,158,113);doc.rect(ox+(p.x-p.width/2+half)*scale,oy+(p.z-p.depth/2+half)*scale,p.width*scale,p.depth*scale,'F');}
    for(const bb of district.buildings){doc.setDrawColor(227,229,214);doc.setLineWidth(.05);const p=bb.parcel;doc.rect(ox+(p.x-p.width/2+half)*scale,oy+(p.z-p.depth/2+half)*scale,p.width*scale,p.depth*scale);doc.setFillColor(...(bb.id===b.id?[210,87,64]:[237,230,211]) as [number,number,number]);doc.rect(ox+(bb.x-bb.width/2+half)*scale,oy+(bb.z-bb.depth/2+half)*scale,bb.width*scale,bb.depth*scale,'F');}
    doc.setTextColor(40,88,73);doc.setFontSize(15);doc.text(district.name,160,68);doc.setFontSize(10);doc.setTextColor(70,83,79);const text=[`${district.buildings.length} linked buildings`,`${district.parks.length} public parks`,`${district.extent} x ${district.extent} m local extent`,'','Red: selected building','Green: public land','Light outlines: parcel boundaries','Grey: 12 m road corridors','','North is at the top.','This is an orthographic diagram,','NOT an aerial photograph.','No imagery acquisition is implied.','','All geometry is synthetic.'];doc.text(text,160,80,{lineHeightFactor:1.7});
  }else{
    const fields=documentFields(kind,b,u,floor);
    for(let i=0;i<fields.length;i++){
      const [label,value]=fields[i];const lines=doc.splitTextToSize(ascii(value),101);const rh=Math.max(10,lines.length*4.5+5);ensure(rh);
      if(i%2===0){doc.setFillColor(243,246,244);doc.rect(17,y-5,width-34,rh,'F');}
      doc.setFontSize(9);doc.setTextColor(97,110,104);doc.text(ascii(label),21,y);doc.setTextColor(38,55,48);doc.text(lines,88,y);y+=rh;
    }
    y+=7;
    if(kind==='plan'){
      const layout=getFloorLayout(b,floor),scale=Math.min(146/b.width,156/b.depth),hh=b.depth*scale;
      ensure(hh+34);
      doc.setTextColor(40,88,73);doc.setFont('helvetica','bold');doc.setFontSize(11);doc.text(`Floor ${floor===0?'G':floor} / shared room layout - synthetic`,17,y);y+=10;
      const sx=(width-b.width*scale)/2,sy=y;
      const X=(x:number)=>sx+(x+b.width/2)*scale,Z=(z:number)=>sy+(z+b.depth/2)*scale;
      doc.setDrawColor(77,107,88);doc.setLineWidth(.35);doc.setFillColor('#c7cec9');doc.rect(sx,sy,b.width*scale,b.depth*scale,'FD');
      doc.setFillColor('#f0efe6');doc.rect(X(-.8),Z(-layout.corridor.depth/2),1.6*scale,layout.corridor.depth*scale,'F');
      for(const {unit,rooms}of layout.units){
        for(const r of rooms){
          doc.setFillColor(roomPalette[r.kind]);doc.setDrawColor(124,146,130);doc.setLineWidth(.25);doc.rect(X(r.x-r.width/2),Z(r.z-r.depth/2),r.width*scale,r.depth*scale,'FD');
          if(r.kind==='bedroom'){doc.setFillColor('#afc0b1');doc.rect(X(r.x-r.width/2+.3),Z(r.z-r.depth/2+.35),Math.min(1.55,r.width-.5)*scale,2*scale,'F');}
          doc.setTextColor(71,95,81);doc.setFont('helvetica','normal');doc.setFontSize(7);doc.text(r.label,X(r.x),Z(r.z+r.depth*.3),{align:'center'});
        }
      }
      doc.setFontSize(9);doc.setTextColor(76,101,85);doc.text(`${b.width.toFixed(1)} m`,width/2,sy-2,{align:'center'});
      doc.setFontSize(8);doc.text(`Depth: ${b.depth.toFixed(1)} m / corridor: 1.6 m`,sx,sy+hh+5);
      y=sy+hh+13;
      for(const {unit}of layout.units){ensure(9);doc.setFont('helvetica','normal');doc.setFontSize(9);doc.text(`Unit ${unit.number}: ${unit.bedrooms} bedroom(s), ${unit.area.toFixed(2)} m2 net room area`,17,y);y+=8;}
    }
    if(kind==='register'){
      ensure(20);doc.setFont('helvetica','bold');doc.setTextColor(40,88,73);doc.text('Floor-wise occupancy schedule (all persons fictional)',17,y);y+=8;
      for(const unit of b.units){ensure(18);doc.setFont('helvetica','bold');doc.setTextColor(45,61,51);doc.text(`Unit ${unit.number} | ${unit.area} m2 | ${unit.tenure}`,17,y);doc.setFont('helvetica','normal');doc.setFontSize(9);doc.text(`${unit.occupant} | ${unit.rent?'Rs. '+money(unit.rent)+' / month':'No rent recorded'}`,17,y+5);y+=16;}
      for(const f of computeFindings(b)){ensure(12);doc.setTextColor(166,76,49);doc.text(ascii(`${f.title}: ${f.value} ${f.unit} (computed demo geometry)`),17,y);y+=9;}
    }
    if(kind==='lease'){
      const note='This specimen links a fictional occupant to a demo unit. Dates, rent and deposit are illustrative metadata. It is not a signed contract, proof of address, registered deed or evidence of real ownership or tenancy. It deliberately contains no identity numbers, signatures or official seals.';
      const lines=doc.splitTextToSize(note,width-34);ensure(lines.length*4.8+14);doc.setTextColor(103,111,104);doc.setFont('helvetica','normal');doc.setFontSize(9);doc.text(lines,17,y,{lineHeightFactor:1.5});
    }
  }
  footer();return doc;
}
export async function downloadDocument(kind:DocumentType,b:Building,u?:Unit,floor=0){
 const {getStudioSources,downloadPreparedAsset}=await import('./useSources');
 try{const manifest=await getStudioSources(),id=preparedDocumentId(kind,b.id,u?.id,floor),d=manifest.documents.find(d=>d.id===id);if(!d)throw new Error('This exact source document has not been prepared');return downloadPreparedAsset('/api/v1/studio/sources/documents/'+encodeURIComponent(d.id),d.filename,d.sha256);}
 catch(error){window.dispatchEvent(new CustomEvent('studio-notice',{detail:error instanceof Error?error.message:'Source unavailable'}));return false;}
}
export function saveJSON(data:unknown,name:string){const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
