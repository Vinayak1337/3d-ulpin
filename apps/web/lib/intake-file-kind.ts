import {unzipSync} from 'fflate';
import {documentFormat} from './document-formats';
export type IntakeFileKind='document'|'gis'|'dataset'|'unsupported';
/** Route by bounded container metadata, not by .zip alone. Full validation follows. */
export async function intakeFileKind(file:{name:string;size:number;arrayBuffer():Promise<ArrayBuffer>}):Promise<IntakeFileKind>{
 if(documentFormat(file.name))return 'document';
 if(!/\.(geojson|json|gpkg|zip)$/i.test(file.name))return 'unsupported';
 if(file.size>20*1024*1024)throw new Error('Choose a file no larger than 20 MiB.');
 if(/\.zip$/i.test(file.name)){
  const paths:string[]=[];
  try{unzipSync(new Uint8Array(await file.arrayBuffer()),{filter:entry=>{paths.push(entry.name);return false;}});}
  catch{throw new Error('The ZIP directory cannot be read. Choose an intact dataset or Shapefile ZIP.');}
  if(paths.length>100)throw new Error('The ZIP exceeds the 100-entry intake limit.');
  return paths.some(path=>/(^|\/)manifest\.json$/i.test(path))?'dataset':'gis';
 }
 if(/\.json$/i.test(file.name)){
  try{const value=JSON.parse(new TextDecoder().decode(await file.arrayBuffer()));
   if(value&&typeof value==='object'&&((typeof value.scene_id==='string'&&value.coordinate_reference_system)||(Array.isArray(value.objects)&&Array.isArray(value.geometries))))return 'dataset';
  }catch{throw new Error('This JSON file cannot be read. Check its syntax and upload it again.');}
 }
 return 'gis';
}
