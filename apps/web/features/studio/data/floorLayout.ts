import type { Building, Rect, Unit } from '../types';

export interface Room extends Rect { id:string; label:string; kind:'bedroom'|'living'|'kitchen'|'bathroom'; area:number }
export interface UnitLayout { unit:Unit; boundary:Rect; rooms:Room[] }
export interface FloorLayout { floor:number; width:number; depth:number; corridor:Rect; units:UnitLayout[] }
const wall=.16;
const round=(n:number)=>Math.round(n*100)/100;
const room=(id:string,label:string,kind:Room['kind'],x:number,z:number,width:number,depth:number):Room=>({id,label,kind,x,z,width,depth,area:round(width*depth)});

function unitRooms(width:number,depth:number,bedrooms:number,side:number):{boundary:Rect;rooms:Room[]} {
  const w=(width-.6-1.6)/2,d=depth-.6;
  const x=side*(.8+w/2),rear=-d/2;
  const bd=d*.37,md=d*.22,ld=d-bd-md-wall*2;
  const rooms:Room[]=[];
  const count=Math.max(1,Math.min(2,bedrooms));
  const bw=(w-wall*(count-1))/count;
  for(let i=0;i<count;i++)rooms.push(room(`bed-${i+1}`,`Bedroom ${i+1}`,'bedroom',x-w/2+bw/2+i*(bw+wall),rear+bd/2,bw,bd));
  const bathroomW=w*.39,kitchenW=w-bathroomW-wall;
  rooms.push(room('bath','Bath / WC','bathroom',x-side*(w/2-bathroomW/2),rear+bd+wall+md/2,bathroomW,md));
  rooms.push(room('kitchen','Kitchen','kitchen',x+side*(w/2-kitchenW/2),rear+bd+wall+md/2,kitchenW,md));
  rooms.push(room('living','Living / dining','living',x,rear+bd+md+wall*2+ld/2,w,ld));
  return {boundary:{x,z:0,width:w,depth:d},rooms};
}
export function unitUsableArea(width:number,depth:number,bedrooms:number){return round(unitRooms(width,depth,bedrooms,1).rooms.reduce((sum,r)=>sum+r.area,0));}

/** One metre-based source for the floor register, SVG, PDF and 3D cutaway. */
export function getFloorLayout(b:Building,floor:number):FloorLayout {
  const units=b.units.filter(u=>u.floor===floor);
  return {floor,width:b.width,depth:b.depth,corridor:{x:0,z:0,width:1.6,depth:b.depth-.6},units:units.map((unit,i)=>({unit,...unitRooms(b.width,b.depth,unit.bedrooms,i===0?-1:1)}))};
}
export const roomPalette:Record<Room['kind'],string>={bedroom:'#e7d7bd',living:'#e7e5d9',kitchen:'#d8ded3',bathroom:'#cbdbdd'};
