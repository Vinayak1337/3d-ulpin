import {Unzlib} from 'fflate';
/** Read the retained 8-bit grayscale class IDs without browser colour conversion. */
export function decodeMaskLabels(bytes:Uint8Array,width:number,height:number):Uint8Array{
 if(width<1||height<1||width*height>4_000_000||!Number.isInteger(width)||!Number.isInteger(height)||bytes.length>32*1024*1024)throw new Error('Mask bounds invalid');
 if(bytes.length<33||[137,80,78,71,13,10,26,10].some((v,i)=>bytes[i]!==v))throw new Error('Invalid PNG');
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),chunks:Uint8Array[]=[];
 let cursor=8,header=false,ended=false;
 while(cursor+12<=bytes.length){
  const size=view.getUint32(cursor),start=cursor+8,end=start+size;
  if(end+4>bytes.length)throw new Error('Truncated PNG');
  const type=String.fromCharCode(...bytes.subarray(cursor+4,start));
  if(type==='IHDR'){
   if(header||size!==13||view.getUint32(start)!==width||view.getUint32(start+4)!==height||bytes[start+8]!==8||bytes[start+9]!==0||bytes[start+10]!==0||bytes[start+11]!==0||bytes[start+12]!==0)throw new Error('Unsupported mask PNG profile');
   header=true;
  }else if(type==='IDAT'){if(!header)throw new Error('Missing PNG header');chunks.push(bytes.subarray(start,end));}
  else if(type==='IEND'){ended=true;break;}
  cursor=end+4;
 }
 if(!header||!ended||!chunks.length)throw new Error('Incomplete PNG');
 const scanlines=new Uint8Array((width+1)*height);let used=0;
 const stream=new Unzlib(chunk=>{if(used+chunk.length>scanlines.length)throw new Error('Mask pixels exceed dimensions');scanlines.set(chunk,used);used+=chunk.length;});
 chunks.forEach((chunk,i)=>stream.push(chunk,i===chunks.length-1));
 if(used!==scanlines.length)throw new Error('Missing mask pixels');
 const labels=new Uint8Array(width*height);
 for(let y=0;y<height;y++){
  const row=y*(width+1),filter=scanlines[row];if(filter>4)throw new Error('Unknown PNG filter');
  for(let x=0;x<width;x++){
   const i=y*width+x,a=x?labels[i-1]:0,b=y?labels[i-width]:0,c=x&&y?labels[i-width-1]:0;
   let prediction=0;
   if(filter===1)prediction=a;
   if(filter===2)prediction=b;
   if(filter===3)prediction=Math.floor((a+b)/2);
   if(filter===4){const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);prediction=pa<=pb&&pa<=pc?a:pb<=pc?b:c;}
   labels[i]=(scanlines[row+x+1]+prediction)&255;
  }
 }
 return labels;
}
