import {jsPDF} from 'jspdf';
import {PacketRegionWorkerSchema} from '../../../../../contracts/src/packet-region';
import {PacketPdfAssemblySchema,PACKET_PDF_RECIPE,PACKET_PDF_LIMITS} from '../../../../../contracts/src/usp/packet-pdf';
import {AppError} from '../../../infrastructure/errors';
import {sha256} from '../../../infrastructure/storage';
import {canonical} from '../../cases/domain';
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
