import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {DocumentPartSchema,DocumentArchiveInventorySchema,DOCUMENT_LIMITS,type DocumentInput,type DocumentResult} from '@ulpin/contracts/usp';
import {settings} from '../../../infrastructure/config';
import {sha256} from '../../../infrastructure/storage';
import {areaGeo} from '../../areas/areas';
import {redactDerivative} from '../ingest/redact';

export function documentReaderSha(){
  const paths=['packages/contracts/src/usp/document-ingestion.ts','packages/server/src/modules/usp/ingestion/document-native.ts',
    'services/geo/geo/area.py','services/geo/geo/native_pdf.py','services/geo/geo/native_schedule.py',
    'services/geo/geo/native_workbook.py','services/geo/geo/native_archive.py',
    'packages/server/src/modules/usp/ingestion/document-model.ts',
    'packages/server/src/modules/usp/ingest/redact.ts'];
  return sha256(Buffer.concat(paths.flatMap(p=>[Buffer.from(p+'\0'),readFileSync(join(settings.repositoryRoot,p))])));
}
/** Bounded byte/container identification. Filenames and claimed MIME do not select a parser. */
export function documentFormat(bytes:Uint8Array):DocumentResult['native']['format']{
  const header=Buffer.from(bytes.subarray(0,16));
  if(header.subarray(0,5).toString()==='%PDF-')return 'pdf';
  if(header.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'png';
  if(header[0]===255 && header[1]===216 && header[2]===255)return 'jpeg';
  if(header[0]===80 && header[1]===75 && header[2]===3 && header[3]===4)return 'archive';
  let text:string;
  try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{return 'unsupported';}
  if(text.includes('\0'))return 'unsupported';
  // JSON/GIS is a different supported authority, not silently recast as document text.
  if(/^[\s\uFEFF]*[\[{]/.test(text)){try{JSON.parse(text);return 'unsupported';}catch{/* Ordinary text may start with a bracket. */}}
  const lines=text.replace(/^\uFEFF/,'').split(/\r?\n/,3);
  return lines.length>1 && lines[0].includes(',') && lines[1].includes(',')?'csv':'text';
}
type Extracted={format?:string;status?:string;code?:string|null;sourceSha256?:string;
  parts:{text:string;locator:{label:string;page?:number;row?:number;line?:number;lineEnd?:number;
    paragraph?:number;table?:number;column?:number;headerRow?:number;sheet?:string;sheetIndex?:number;sheetId?:number;
    cell?:string;cellState?:string;cellType?:string}}[];warnings?:string[];
  archiveInventory?:DocumentResult['native']['archiveInventory']};
/** Keep exact redacted-unit spans; prefer a source line/word boundary for long units. */
function unitSegments(text:string){
  const segments:{start:number;end:number}[]=[];
  for(let start=0;start<text.length;){
    let end=Math.min(start+DOCUMENT_LIMITS.partCharacters,text.length);
    if(end<text.length){
      const halfway=start+Math.floor(DOCUMENT_LIMITS.partCharacters/2);
      const line=text.lastIndexOf('\n',end-1);
      if(line>=halfway)end=line+1;
      else for(let index=end;index>halfway;index--)if(/\s/u.test(text[index-1])){end=index;break;}
      // JavaScript offsets are UTF-16; a segment cannot end inside a surrogate pair.
      if(end<text.length && /[\uD800-\uDBFF]/u.test(text[end-1]) && /[\uDC00-\uDFFF]/u.test(text[end]))end--;
    }
    segments.push({start,end});start=end;
  }
  return segments;
}
export async function extractSourceDocument(input:DocumentInput,bytes:Uint8Array,
  extract:(data:unknown)=>Promise<Extracted>=data=>areaGeo<Extracted>('extract',data)):Promise<DocumentResult['native']>{
  let format=documentFormat(bytes);
  const base={format,readerSha256:input.readerSha256,code:null,warnings:[] as string[],parts:[] as DocumentResult['native']['parts']};
  if(format==='png'||format==='jpeg')return {...base,status:'needs_ocr',code:'OCR_TOOL_UNAVAILABLE'};
  if(format==='unsupported')return {...base,status:'unsupported',code:'DOCUMENT_FORMAT_UNSUPPORTED'};
  if(bytes.length>DOCUMENT_LIMITS.nativeBytes)return {...base,status:'tool_error',code:'NATIVE_READER_BYTE_LIMIT'};
  try{
    const parsed=await extract({format:format==='archive'?'archive':format==='csv'?'csv_reference':format,base64:Buffer.from(bytes).toString('base64')});
    if(parsed.sourceSha256!==input.sourceSha256)throw new Error('NATIVE_SOURCE_HASH');
    if(format==='archive'){
      if(parsed.format!=='docx'&&parsed.format!=='xlsx'&&parsed.format!=='archive')throw new Error('NATIVE_FORMAT_MISMATCH');
      format=parsed.format;
      if(format==='archive' && !parsed.archiveInventory)throw new Error('NATIVE_ARCHIVE_INVENTORY_MISSING');
    }
    const archiveInventory=parsed.archiveInventory===undefined?undefined:DocumentArchiveInventorySchema.parse(parsed.archiveInventory);
    if(archiveInventory && (format!=='archive'||archiveInventory.sourceSha256!==input.sourceSha256||parsed.parts.length))
      throw new Error('NATIVE_ARCHIVE_INVENTORY_SCOPE');
    const warnings=redactDerivative(parsed.warnings??[]).slice(0,100).map(w=>String(w).slice(0,512));
    const parts:DocumentResult['native']['parts']=[];let characters=0;
    for(const raw of parsed.parts){
      const text=String(redactDerivative(raw.text));characters+=text.length;
      if(characters>DOCUMENT_LIMITS.characters)throw new Error('NATIVE_TEXT_LIMIT');
      if(!text.trim() && raw.locator.cellState!=='whitespace' && raw.locator.cellState!=='formula_cached')continue;
      const unitId=randomUUID(),unitSha256=sha256(text),segments=unitSegments(text);
      for(const [segmentIndex,{start,end}] of segments.entries()){
        const value=text.slice(start,end);
        if(parts.length>=DOCUMENT_LIMITS.parts)throw new Error('NATIVE_PART_LIMIT');
        parts.push(DocumentPartSchema.parse({id:randomUUID(),sourceId:input.sourceId,sourceRevision:input.sourceRevision,
          sourceSha256:input.sourceSha256,text:value,sha256:sha256(value),method:'native_text',
          locator:{...redactDerivative(raw.locator),unitId,unitSha256,segmentIndex,
            segmentCount:segments.length,characterStart:start,characterEnd:end}}));
      }
    }
    return {format,readerSha256:input.readerSha256,...(archiveInventory?{archiveInventory}:{}),
      code:parsed.code??(parts.length?(warnings.some(w=>w.includes('no native text'))?'NATIVE_PARTIAL_TEXT':null):'NATIVE_TEXT_UNAVAILABLE'),
      warnings,parts,status:parsed.status==='unsupported'?'unsupported':parts.length?'extracted':format==='pdf'?'needs_ocr':format==='xlsx'?'unsupported':'extracted'};
  }catch(error){
    const message=error instanceof Error?error.message:'';
    const encrypted=/^Encrypted PDFs|\bencrypted\b|decrypt|password/i.test(message),
      unsupported=format==='archive' && /no Word document part|no document body/i.test(message);
    return {...base,status:encrypted?'encrypted':unsupported?'unsupported':'tool_error',
      code:encrypted?'DOCUMENT_ENCRYPTED':unsupported?'ARCHIVE_DOCUMENT_UNSUPPORTED':/^(NATIVE_[A-Z_]+)$/.test(message)?message:'NATIVE_EXTRACTION_FAILED'};
  }
}
