import {jsPDF} from 'jspdf';
import {PacketMixedPdfAssemblyEntriesSchema,PacketMixedPdfAssemblySchema,PACKET_MIXED_PDF_RECIPE,
  PACKET_MIXED_PDF_POLICY,PACKET_MIXED_PDF_LIMITS} from '../../../../../contracts/src/usp/packet-mixed-pdf';
import {AppError} from '../../../infrastructure/errors';
import {sha256} from '../../../infrastructure/storage';
import {canonical,fingerprint} from '../../cases/domain';
import {assertCleanRegionPng,packetRegionTransform} from './region-extract';
import {assertCleanImageRegionPng,packetImageRegionTransform} from './image-region';
import {assertImagePdfRgb} from './image-pdf-render';

/** Sequential bounded crop assembly only. No original objects or record facts. */
export async function assemblePacketMixedPdf(raw:readonly unknown[],readCrop:(index:number)=>Promise<Buffer>,live=()=>{}){
  if(raw.length!==2)throw new AppError(422,'PACKET_MIXED_PDF_ENTRIES','Select exactly one reviewed PDF-page and one reviewed image region.');
  const entries=PacketMixedPdfAssemblyEntriesSchema.parse(raw);
  const processedPixels=entries.reduce((n,e)=>n+e.derivative.output.pixels[0]*e.derivative.output.pixels[1],0);
  for(const entry of entries){
    const region=entry.derivative;
    if(entry.kind==='original_image_region'){
      assertImagePdfRgb(entry.derivative);const expected=packetImageRegionTransform(entry.derivative.selection);
      if(canonical(region.transform)!==canonical(expected.transform)||canonical(region.output.pixels)!==canonical(expected.pixels))
        throw new AppError(422,'PACKET_PDF_CROP_INTEGRITY','Use the exact verified original-image transform and pixels.');
    }else if(canonical(region.transform)!==canonical(packetRegionTransform(entry.derivative.selection)))
      throw new AppError(422,'PACKET_PDF_CROP_INTEGRITY','Use the exact verified PDF-page transform.');
  }
  const [width,height]=entries[0].derivative.output.pixels;
  const doc=new jsPDF({unit:'pt',format:[width*.75,height*.75],orientation:width>height?'landscape':'portrait',compress:true,putOnlyUsedFonts:true});
  doc.setProperties({title:'Private selected-region packet',subject:PACKET_MIXED_PDF_RECIPE,creator:'3D ULPIN'});
  doc.setCreationDate("D:20000101000000+00'00'");doc.setFileId(fingerprint(entries.map(e=>({kind:e.kind,sha256:e.derivative.output.sha256}))).slice(0,32).toUpperCase());
  for(const [index,entry] of entries.entries()){
    live();const png=await readCrop(index);live();const {output}=entry.derivative,[w,h]=output.pixels;
    if(png.length!==output.bytes||sha256(png)!==output.sha256)throw new AppError(422,'PACKET_PDF_CROP_INTEGRITY','Use the exact accepted crop bytes.');
    if(entry.kind==='original_image_region')assertCleanImageRegionPng(png,[w,h],'RGB');else assertCleanRegionPng(png,[w,h]);
    if(index)doc.addPage([w*.75,h*.75],w>h?'landscape':'portrait');
    doc.addImage(new Uint8Array(png),'PNG',0,0,w*.75,h*.75,undefined,'FAST');live();
  }
  const bytes=Buffer.from(doc.output('arraybuffer'));live();
  if(bytes.length>PACKET_MIXED_PDF_LIMITS.bytes)throw new AppError(413,'PACKET_PDF_OUTPUT_LIMIT','The two-page mixed PDF exceeds 32 MiB.');
  return {bytes,manifest:PacketMixedPdfAssemblySchema.parse({version:'packet-mixed-pdf-assembly/1',recipe:PACKET_MIXED_PDF_RECIPE,entries,
    output:{sha256:sha256(bytes),bytes:bytes.length,contentType:'application/pdf',pages:2,processedPixels,policy:PACKET_MIXED_PDF_POLICY}})};
}
