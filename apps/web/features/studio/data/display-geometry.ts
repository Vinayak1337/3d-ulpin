import type {Rect} from '../types';

/** Non-overlapping display patches for A \ B. The original records are immutable. */
export function rectangleDifference(a:Rect,b:Rect):Rect[]{
  const l=a.x-a.width/2,r=a.x+a.width/2,t=a.z-a.depth/2,d=a.z+a.depth/2;
  const il=Math.max(l,b.x-b.width/2),ir=Math.min(r,b.x+b.width/2);
  const it=Math.max(t,b.z-b.depth/2),ib=Math.min(d,b.z+b.depth/2);
  if(ir<=il||ib<=it)return [{...a}];
  const result:Rect[]=[];
  const add=(x0:number,z0:number,x1:number,z1:number)=>{
    if(x1-x0>1e-9&&z1-z0>1e-9)result.push({x:(x0+x1)/2,z:(z0+z1)/2,width:x1-x0,depth:z1-z0});
  };
  add(l,t,r,it);add(l,ib,r,d);add(l,it,il,ib);add(ir,it,r,ib);
  return result;
}
