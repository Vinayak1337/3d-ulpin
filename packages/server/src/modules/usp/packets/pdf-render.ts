import {jsPDF} from 'jspdf';
import {PacketRegionWorkerSchema} from '../../../../../contracts/src/packet-region';
import {PacketPdfAssemblySchema,PACKET_PDF_RECIPE,PACKET_PDF_LIMITS} from '../../../../../contracts/src/usp/packet-pdf';
import {PacketPdfMultiAssemblySchema,PACKET_PDF_MULTI_RECIPE,PACKET_PDF_MULTI_LIMITS} from '../../../../../contracts/src/usp/packet-pdf';
import {AppError} from '../../../infrastructure/errors';
import {sha256} from '../../../infrastructure/storage';
import {canonical,fingerprint} from '../../cases/domain';
import {assertCleanRegionPng,packetRegionTransform} from './region-extract';

/** Pure bounded assembly of one already checked crop. No original PDF, record
 * names, caller text, URL, annotations, source objects or fonts enter this leaf.
 * Current plan/applicability authorization belongs to the publishing service. */
export function assemblePacketPdf(rawRegion:unknown,png:Buffer){
  const region=PacketRegionWorkerSchema.parse(rawRegion),[width,height]=region.output.pixels;
  if(width*height>PACKET_PDF_LIMITS.pixels||sha256(png)!==region.output.sha256||png.length!==region.output.bytes||
    canonical(region.transform)!==canonical(packetRegionTransform(region.selection)))
    throw new AppError(422,'PACKET_PDF_CROP_INTEGRITY','Use the exact verified crop bytes and transform.');
  assertCleanRegionPng(png,[width,height]);
  const doc=new jsPDF({unit:'pt',format:[width*.75,height*.75],
    orientation:width>height?'landscape':'portrait',compress:true,putOnlyUsedFonts:true});
  // Only fixed generic metadata. Determinism avoids retaining incidental host
  // dates/identifiers; original/target/provenance pins stay in the private manifest.
  doc.setProperties({title:'Private selected-region packet',subject:PACKET_PDF_RECIPE,creator:'3D ULPIN'});
  doc.setCreationDate('D:20000101000000+00\'00\'');
  doc.setFileId(region.output.sha256.slice(0,32).toUpperCase());
  doc.addImage(new Uint8Array(png),'PNG',0,0,width*.75,height*.75,undefined,'FAST');
  const bytes=Buffer.from(doc.output('arraybuffer'));
  if(bytes.length>PACKET_PDF_LIMITS.bytes)
    throw new AppError(413,'PACKET_PDF_OUTPUT_LIMIT','The one-region PDF exceeds its bounded output profile.');
  const manifest=PacketPdfAssemblySchema.parse({version:'packet-pdf-assembly/1',recipe:PACKET_PDF_RECIPE,region,
    output:{sha256:sha256(bytes),bytes:bytes.length,contentType:'application/pdf',pages:1,
      policy:'fresh_rgb_image_only; no_source_pdf_objects/1'}});
  return {bytes,manifest};
}

/** Fetch/validate/add one crop at a time. jsPDF retains compressed image streams,
 * not a collection of decoded page bitmaps. No original page object is copied. */
export async function assemblePacketPdfRegions(rawRegions:readonly unknown[],readCrop:(index:number)=>Promise<Buffer>,live=()=>{}){
  if(rawRegions.length<2||rawRegions.length>PACKET_PDF_MULTI_LIMITS.pages)
    throw new AppError(422,'PACKET_PDF_REGIONS','Select two to four required reviewed regions.');
  const regions=rawRegions.map(raw=>PacketRegionWorkerSchema.parse(raw)),first=regions[0];
  let processedPixels=0;
  for(const region of regions){
    const [width,height]=region.output.pixels;processedPixels+=width*height;
    if(region.sourceSha256!==first.sourceSha256||region.sourceBytes!==first.sourceBytes||
      width*height>PACKET_PDF_LIMITS.pixels||canonical(region.transform)!==canonical(packetRegionTransform(region.selection)))
      throw new AppError(422,'PACKET_PDF_CROP_INTEGRITY','Use exact verified crops from one unchanged original.');
  }
  if(processedPixels>PACKET_PDF_MULTI_LIMITS.pixels)
    throw new AppError(413,'PACKET_PDF_PIXEL_LIMIT','The selected regions exceed the cumulative pixel profile.');
  const [width,height]=first.output.pixels;
  const doc=new jsPDF({unit:'pt',format:[width*.75,height*.75],orientation:width>height?'landscape':'portrait',
    compress:true,putOnlyUsedFonts:true});
  doc.setProperties({title:'Private selected-region packet',subject:PACKET_PDF_MULTI_RECIPE,creator:'3D ULPIN'});
  doc.setCreationDate('D:20000101000000+00\'00\'');
  doc.setFileId(fingerprint(regions.map(region=>region.output.sha256)).slice(0,32).toUpperCase());
  for(const [index,region] of regions.entries()){
    live();const png=await readCrop(index);live();
    if(png.length!==region.output.bytes||sha256(png)!==region.output.sha256)
      throw new AppError(422,'PACKET_PDF_CROP_INTEGRITY','Use the exact verified crop bytes and transform.');
    const [w,h]=region.output.pixels;assertCleanRegionPng(png,[w,h]);
    if(index)doc.addPage([w*.75,h*.75],w>h?'landscape':'portrait');
    doc.addImage(new Uint8Array(png),'PNG',0,0,w*.75,h*.75,undefined,'FAST');live();
  }
  const bytes=Buffer.from(doc.output('arraybuffer'));live();
  if(bytes.length>PACKET_PDF_MULTI_LIMITS.bytes)
    throw new AppError(413,'PACKET_PDF_OUTPUT_LIMIT','The selected-region PDF exceeds its bounded output profile.');
  const manifest=PacketPdfMultiAssemblySchema.parse({version:'packet-pdf-assembly/2',recipe:PACKET_PDF_MULTI_RECIPE,regions,
    output:{sha256:sha256(bytes),bytes:bytes.length,contentType:'application/pdf',pages:regions.length,processedPixels,
      policy:'fresh_rgb_image_only; no_source_pdf_objects/1'}});
  return {bytes,manifest};
}
