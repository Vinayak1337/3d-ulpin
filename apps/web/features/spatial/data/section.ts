import type {AreaGeometry} from '@ulpin/contracts';
export type SectionAxis='east-west'|'north-south';
export interface SectionBody{id:string;label:string;geometry:AreaGeometry;lower:number;upper:number;reference:string}
export interface SectionSpan{start:number;end:number;lower:number;upper:number;id:string;label:string;reference:string}
const polygons=(g:AreaGeometry):number[][][][]=>g.type==='Polygon'?[g.coordinates]:g.type==='MultiPolygon'?g.coordinates:g.type==='GeometryCollection'?g.geometries.flatMap(polygons):[];
/** Even/odd line intersection preserves holes and concavity. This is a view of
 * supplied prism boundaries, not a new parcel or an inferred ownership boundary. */
export function prismSection(body:SectionBody,axis:SectionAxis,position:number):SectionSpan[]{
 if(!Number.isFinite(position)||!Number.isFinite(body.lower)||!Number.isFinite(body.upper)||body.upper<=body.lower||!body.reference)return [];
 const along=axis==='east-west'?0:1,cross=1-along,result:SectionSpan[]=[];
 for(const polygon of polygons(body.geometry)){
  const cuts:number[]=[];
  for(const ring of polygon){
   if(ring.length<3||ring.some(p=>p.length!==2||!p.every(Number.isFinite)))throw new Error('Section source has invalid coordinates');
   for(let i=0;i<ring.length;i++){
    const a=ring[i],b=ring[(i+1)%ring.length];
    if((a[cross]>position)===(b[cross]>position))continue;
    const t=(position-a[cross])/(b[cross]-a[cross]);cuts.push(a[along]+t*(b[along]-a[along]));
   }
  }
  cuts.sort((a,b)=>a-b);
  if(cuts.length%2)throw new Error('Section intersects an invalid polygon boundary');
  for(let i=0;i<cuts.length;i+=2)if(cuts[i+1]-cuts[i]>1e-8)result.push({id:body.id,label:body.label,start:cuts[i],end:cuts[i+1],lower:body.lower,upper:body.upper,reference:body.reference});
 }
 return result;
}
export function sectionBounds(bodies:readonly SectionBody[]):[number,number,number,number,number,number]|null{
 let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity,minZ=Infinity,maxZ=-Infinity;
 for(const b of bodies){if(!Number.isFinite(b.lower)||!Number.isFinite(b.upper))continue;for(const polygon of polygons(b.geometry))for(const ring of polygon)for(const [x,y]of ring){if(!Number.isFinite(x)||!Number.isFinite(y))continue;minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}minZ=Math.min(minZ,b.lower);maxZ=Math.max(maxZ,b.upper);}
 return [minX,minY,maxX,maxY,minZ,maxZ].every(Number.isFinite)?[minX,minY,maxX,maxY,minZ,maxZ]:null;
}
