import {PRIVATE_MVT_PROFILE as p,PrivateMvtCellSchema,type PrivateMvtCell} from '@ulpin/contracts/usp';
import {AppError} from '../../../infrastructure/errors';
export type Bounds=[number,number,number,number];
export const cellKey=(cell:PrivateMvtCell)=>`${cell.z}/${cell.x}/${cell.y}`;
export function sortedCells(cells:Iterable<PrivateMvtCell>){
  const unique=new Map<string,PrivateMvtCell>();for(const cell of cells)unique.set(cellKey(cell),PrivateMvtCellSchema.parse(cell));
  if(unique.size>p.cells)throw new AppError(422,'MVT_GRID_BUDGET','The requested catalog or invalidation exceeds the explicit 128-cell profile.');
  return [...unique.values()].sort((a,b)=>a.z-b.z||a.x-b.x||a.y-b.y);
}
export function boundsCells(bounds:Bounds,halo=true){
  if(!bounds.every(Number.isFinite)||bounds[0]>bounds[2]||bounds[1]>bounds[3]||bounds[0]<-180||bounds[2]>180||bounds[1]<-85.05112878||bounds[3]>85.05112878)
    throw new AppError(422,'MVT_REFERENCE','The accepted geographic extent is outside the qualified Web Mercator frame.');
  const result:PrivateMvtCell[]=[];
  for(let z=p.minimumZoom;z<=p.maximumZoom;z++){
    const n=2**z,pad=halo?p.buffer/p.extent:0,x=(lon:number)=>(lon+180)/360*n,
      y=(lat:number)=>(1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*n;
    const minX=Math.max(0,Math.floor(x(bounds[0])-pad)),maxX=Math.min(n-1,Math.floor(x(bounds[2])+pad)),
      minY=Math.max(0,Math.floor(y(bounds[3])-pad)),maxY=Math.min(n-1,Math.floor(y(bounds[1])+pad));
    for(let cx=minX;cx<=maxX;cx++)for(let cy=minY;cy<=maxY;cy++)result.push({z,x:cx,y:cy});
  }
  return sortedCells(result);
}
export function windowCells(window:{z:number;minX:number;maxX:number;minY:number;maxY:number}){
  const result:PrivateMvtCell[]=[];
  for(let x=window.minX;x<=window.maxX;x++)for(let y=window.minY;y<=window.maxY;y++){
    for(let z=window.z;z>=p.minimumZoom;z--){const scale=2**(window.z-z);result.push({z,x:Math.floor(x/scale),y:Math.floor(y/scale)});}
  }
  return sortedCells(result);
}
export function extentOf(rows:{bounds:Bounds|null}[]):Bounds{
  const values=rows.flatMap(row=>row.bounds?[row.bounds]:[]);
  if(!values.length)throw new AppError(422,'MVT_NO_ADMITTED_GEOMETRY','The accepted profile has no admitted geographic context.');
  return [Math.min(...values.map(b=>b[0])),Math.min(...values.map(b=>b[1])),Math.max(...values.map(b=>b[2])),Math.max(...values.map(b=>b[3]))];
}
