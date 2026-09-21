import {fromArrayBuffer} from 'geotiff';

export type SurveyKind='lidar'|'imagery'|'dem'|'dsm';
export interface SurveyAsset {
 id:string;kind:SurveyKind;label:string;sourceId:string;sourcePath:string;sourceSha256:string;
 frameId:string;verticalReference:string;classification:string;sourceRevision:string;
 positions?:Float32Array;colors?:Uint8Array;pointCount?:number;displayedPoints?:number;
 width?:number;height?:number;sourceWidth?:number;sourceHeight?:number;
 affine?:number[];rgba?:Uint8Array;elevations?:Float32Array;valid?:Uint8Array;
 minimum:number;maximum:number;bounds?:number[];
}
interface Frame {id:string;name:string;nativeCrs?:string;verticalDatum:string;horizontalUnit:string;verticalUnit:string;}
interface Source {id:string;originalUri?:unknown;originalSha256?:unknown;revision:string|number;classification?:unknown;}
type RecordFields=Record<string,unknown>;
const text=new TextDecoder();
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const close=(a:number,b:number)=>Math.abs(a-b)<=Math.max(1e-5,Math.abs(b)*1e-7);
const MAX_DISPLAY_POINTS=200_000;

/** Read XYZ/RGB directly from an uncompressed LAS, never from the model geometry. */
export function decodeLas(bytes:Uint8Array){
 if(bytes.length<227||text.decode(bytes.subarray(0,4))!=='LASF')throw new Error('Invalid or truncated LAS header.');
 const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),minor=v.getUint8(25);
 if(v.getUint8(24)!==1||minor>4)throw new Error('Supported LAS versions are 1.0–1.4.');
 const header=v.getUint16(94,true),offset=v.getUint32(96,true),format=v.getUint8(104),size=v.getUint16(105,true);
 const sizes=[20,28,26,34,57,63,30,36,38,59,67];
 if(format&128)throw new Error('Compressed LAZ retained; supply its uncompressed LAS equivalent for this viewer.');
 if(format>10||size<sizes[format]||header<227||offset<header||offset>bytes.length)throw new Error('Invalid LAS point layout.');
 let vlr=header;
 for(let i=0;i<v.getUint32(100,true);i++){
  if(vlr+54>offset)throw new Error('Truncated LAS variable-length record.');
  const length=v.getUint16(vlr+20,true),user=text.decode(bytes.subarray(vlr+2,vlr+18)).replace(/\0/g,'').trim();
  if(vlr+54+length>offset)throw new Error('Truncated LAS variable-length payload.');
  if(user==='LASF_Projection')throw new Error('LAS contains a CRS definition; review its transform into the local metre frame first.');
  vlr+=54+length;
 }
 let count=v.getUint32(107,true);
 if(minor===4){if(header<375||bytes.length<375)throw new Error('Truncated LAS 1.4 header.');const extended=Number(v.getBigUint64(247,true));if(extended)count=extended;}
 if(!Number.isSafeInteger(count)||count<1||count>1_000_000||offset+count*size>bytes.length)throw new Error('LAS point count is empty, truncated or exceeds 1 million points.');
 const scale=[131,139,147].map(p=>v.getFloat64(p,true)),origin=[155,163,171].map(p=>v.getFloat64(p,true));
 if(scale.some(s=>!finite(s)||s<=0)||origin.some(n=>!finite(n)))throw new Error('Invalid LAS coordinate scale.');
 const stride=Math.ceil(count/MAX_DISPLAY_POINTS),displayed=Math.ceil(count/stride),positions=new Float32Array(displayed*3),colors=new Uint8Array(displayed*3);
 const bounds=[Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity];let minimum=Infinity,maximum=-Infinity,j=0;
 const rgbOffset=format===2?20:[3,5].includes(format)?28:[7,8,10].includes(format)?30:null;
 for(let i=0;i<count;i++){
  const p=offset+i*size,xyz=[0,4,8].map((s,k)=>v.getInt32(p+s,true)*scale[k]+origin[k]);
  if(xyz.some(n=>!finite(n)||Math.abs(n)>5000))throw new Error('LAS needs a reviewed transform to the local metre frame (5 km display limit).');
  xyz.forEach((n,k)=>{bounds[k]=Math.min(bounds[k],n);bounds[k+3]=Math.max(bounds[k+3],n);});minimum=Math.min(minimum,xyz[2]);maximum=Math.max(maximum,xyz[2]);
  if(i%stride)continue;
  positions.set(xyz,j*3);
  const cls=v.getUint8(p+(format>=6?16:15))&(format>=6?255:31);
  const rgb=rgbOffset===null?null:[0,2,4].map(s=>v.getUint16(p+rgbOffset+s,true));
  colors.set(rgb&&rgb.some(Boolean)?rgb.map(n=>Math.round(n/257)):cls===2?[106,151,125]:[229,186,91],j*3);j++;
 }
 return {positions,colors,pointCount:count,displayedPoints:displayed,minimum,maximum,bounds};
}

/** Disposable rendering projection. Missing/unsupported evidence never invalidates vector records. */
export async function readSurveyAssets(files:ReadonlyMap<string,Uint8Array>,frames:readonly Frame[],sources:readonly Source[]){
 const assets:SurveyAsset[]=[],diagnostics:{path:string;message:string}[]=[];
 const profiles=[['normalized/lidar_assets.json','lidar','canonical.lidar-assets.v1'],['normalized/imagery_assets.json','imagery','canonical.imagery-assets.v1'],['normalized/elevation_surfaces.json','elevation','canonical.elevation-surfaces.v1']] as const;
 for(const [path,profile,schema] of profiles){
  const metadata=files.get(path);if(!metadata)continue;
  let records:RecordFields[];
  try{const parsed=JSON.parse(text.decode(metadata));if(parsed.schema!==schema||!Array.isArray(parsed.records)||parsed.records.length>32)throw new Error('Unsupported source asset metadata.');records=parsed.records;}catch(e){diagnostics.push({path,message:e instanceof Error?e.message:'Invalid asset metadata.'});continue;}
  for(const record of records){
   const sourcePath=String(record?.sourceFile??'');
   if(record?.type==='preview'||record?.representationStatus==='compressed_equivalent')continue;
   try{
    if(assets.length>=8)throw new Error('This detailed view supports eight survey assets per package.');
    const source=sources.find(s=>s.originalUri===`dataset/${sourcePath}`),bytes=files.get(sourcePath);
    if(!source||!bytes||typeof source.originalSha256!=='string')throw new Error('No verified original is linked to this asset.');
    const frame=frames.find(f=>[f.id,f.name,f.nativeCrs].includes(String(record.coordinateFrame)));
    if(!frame||frame.horizontalUnit!=='metre'||frame.verticalUnit!=='metre')throw new Error('A matching local metre coordinate frame is required.');
    const kind:SurveyKind=profile==='elevation'?(record.type==='DEM'?'dem':record.type==='DSM'?'dsm':(()=>{throw new Error('Elevation type must be DEM or DSM.');})()):profile;
    if(kind!=='imagery'&&record.verticalReference!==frame.verticalDatum)throw new Error('Vertical benchmark differs from the map; review alignment first.');
    const base={id:`survey/${source.id}`,kind,label:kind==='lidar'?'LiDAR point cloud':kind==='imagery'?'Drone imagery':kind.toUpperCase(),sourceId:source.id,sourcePath,sourceSha256:source.originalSha256,frameId:frame.id,verticalReference:kind==='imagery'?'Flat orthomosaic display':frame.verticalDatum,classification:String(source.classification??'unspecified'),sourceRevision:String(source.revision)};
    if(kind==='lidar'){
     if(!sourcePath.toLowerCase().endsWith('.las'))throw new Error('This viewer reads LAS; compressed LAZ requires an uncompressed LAS equivalent.');
     const cloud=decodeLas(bytes);
     if(record.pointCount!==cloud.pointCount)throw new Error('LAS point count disagrees with asset metadata.');
     assets.push({...base,...cloud});continue;
    }
    const affine=record.affineTransform;
    if(!Array.isArray(affine)||affine.length!==6||!affine.every(finite)||affine[0]<=0||affine[4]>=0||affine[1]!==0||affine[3]!==0)throw new Error('A north-up affine transform in the map frame is required.');
    const tiff=await fromArrayBuffer(new Uint8Array(bytes).buffer),image=await tiff.getImage(),sourceWidth=image.getWidth(),sourceHeight=image.getHeight();
    if(!sourceWidth||!sourceHeight||sourceWidth*sourceHeight>4_000_000||image.getSamplesPerPixel()>4)throw new Error('Raster exceeds the four-million-pixel / four-band preview limit.');
    if(sourceWidth!==record.width||sourceHeight!==record.height)throw new Error('GeoTIFF dimensions disagree with asset metadata.');
    const origin=image.getOrigin(),resolution=image.getResolution(),keys=image.getGeoKeys();
    if(!image.pixelIsArea()||!close(origin[0],affine[2])||!close(origin[1],affine[5])||!close(resolution[0],affine[0])||!close(resolution[1],affine[4]))throw new Error('GeoTIFF grid disagrees with the declared pixel-area alignment.');
    if(keys?.ProjectedCSTypeGeoKey&&keys.ProjectedCSTypeGeoKey!==32767||keys?.GeographicTypeGeoKey&&keys.GeographicTypeGeoKey!==32767)throw new Error('Projected/geographic rasters need a reviewed transform into the local frame.');
    const bounds=[affine[2],affine[5]+sourceHeight*affine[4],affine[2]+sourceWidth*affine[0],affine[5]];
    if(bounds.some(n=>Math.abs(n)>5000))throw new Error('Raster exceeds the local 5 km display limit.');
    const step=Math.max(1,Math.ceil(Math.max(sourceWidth,sourceHeight)/512)),width=Math.ceil(sourceWidth/step),height=Math.ceil(sourceHeight/step);
    const displayAffine=[affine[0]*sourceWidth/width,0,affine[2],0,affine[4]*sourceHeight/height,affine[5]];
    if(kind==='imagery'){
     if(image.getSamplesPerPixel()<3||[0,1,2].some(b=>image.getBitsPerSample(b)!==8))throw new Error('Imagery preview requires 8-bit RGB bands.');
     const rgb=await image.readRGB({width,height,interleave:true});
     const rgba=new Uint8Array(width*height*4);for(let i=0;i<width*height;i++){rgba[i*4]=Number(rgb[i*3]);rgba[i*4+1]=Number(rgb[i*3+1]);rgba[i*4+2]=Number(rgb[i*3+2]);rgba[i*4+3]=255;}
     assets.push({...base,width,height,sourceWidth,sourceHeight,affine:displayAffine,bounds:[bounds[0],bounds[1],0,bounds[2],bounds[3],0],rgba,minimum:0,maximum:0});
    }else{
     if(sourceWidth<2||sourceHeight<2)throw new Error('Elevation surface needs at least a 2 × 2 grid.');
     if(image.getSamplesPerPixel()!==1)throw new Error('DEM/DSM requires one elevation band.');
     const samples=await image.readRasters({samples:[0],width,height,interleave:true}),nodata=image.getGDALNoData(),elevations=new Float32Array(width*height),valid=new Uint8Array(width*height);let minimum=Infinity,maximum=-Infinity;
     for(let i=0;i<elevations.length;i++){const z=Number(samples[i]);if(!Number.isFinite(z)||z===nodata)continue;if(Math.abs(z)>5000)throw new Error('Elevation exceeds the local 5 km display limit.');elevations[i]=z;valid[i]=1;minimum=Math.min(minimum,z);maximum=Math.max(maximum,z);}
     if(!Number.isFinite(minimum))throw new Error('Elevation raster contains no valid cells.');
     assets.push({...base,width,height,sourceWidth,sourceHeight,affine:displayAffine,bounds:[bounds[0],bounds[1],minimum,bounds[2],bounds[3],maximum],elevations,valid,minimum,maximum});
    }
   }catch(e){diagnostics.push({path:sourcePath,message:e instanceof Error?e.message:'Unable to render source.'});}
  }
 }
 return {assets,diagnostics};
}
