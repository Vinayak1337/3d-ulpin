import {deflateSync} from "node:zlib";

const crcTable=Array.from({length:256},(_,i)=>{let c=i;for(let bit=0;bit<8;bit++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
function crc(bytes:Buffer){let c=0xffffffff;for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
function chunk(kind:string,bytes:Buffer){const type=Buffer.from(kind),header=Buffer.alloc(4),tail=Buffer.alloc(4);header.writeUInt32BE(bytes.length);tail.writeUInt32BE(crc(Buffer.concat([type,bytes])));return Buffer.concat([header,type,bytes,tail]);}
/** Deterministic micro-material texture, not geographic imagery or inferred building detail. */
export function materialTexture(kind:"plaster"|"mineral"|"paving"):Buffer {
  const size=128,row=size*3+1,data=Buffer.alloc(row*size);let seed=kind==="plaster"?9103:kind==="mineral"?4073:8117;
  const noise=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/0x100000000;};
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    let value=kind==="plaster"?248+(noise()-.5)*10:242+(noise()-.5)*20;
    if(kind==="paving"){
      const shifted=(x+(Math.floor(y/32)%2)*32)%64;
      value=(y%32<2||shifted<2?214:249)+(noise()-.5)*7;
    }
    const i=y*row+1+x*3,v=Math.max(0,Math.min(255,Math.round(value)));data[i]=v;data[i+1]=v;data[i+2]=v;
  }
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(size,0);ihdr.writeUInt32BE(size,4);ihdr[8]=8;ihdr[9]=2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",ihdr),chunk("IDAT",deflateSync(data,{level:9})),chunk("IEND",Buffer.alloc(0))]);
}
export const materialTextureProfile=(material:number)=>material<=3?{texture:0,metres:5}:material===4||material===7||material===9?{texture:1,metres:2}:material===8?{texture:2,metres:1}:null;
