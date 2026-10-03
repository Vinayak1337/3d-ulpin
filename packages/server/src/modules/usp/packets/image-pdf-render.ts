import {jsPDF} from 'jspdf';
import {PacketImageRegionWorkerSchema} from '../../../../../contracts/src/packet-image-region';
import {PacketImagePdfAssemblySchema,PACKET_IMAGE_PDF_RECIPE,PACKET_IMAGE_PDF_POLICY,PACKET_IMAGE_PDF_LIMITS}
  from '../../../../../contracts/src/usp/packet-image-pdf';
import {AppError} from '../../../infrastructure/errors';
import {sha256} from '../../../infrastructure/storage';
import {canonical} from '../../cases/domain';
import {assertCleanImageRegionPng,packetImageRegionTransform} from './image-region';

export function assertImagePdfRgb(region:{output:{mode:string};sourceImage:{color:{transparency:string}}}){
  if(region.output.mode!=='RGB'||region.sourceImage.color.transparency!=='absent')throw new AppError(422,'PACKET_IMAGE_PDF_ALPHA_UNSUPPORTED',
    'This single-image PDF recipe supports RGB crops only. Alpha images require a separately supported recipe.');
}
/** Pure assembly from fresh checked crop pixels only. No original or caller metadata. */
export function assemblePacketImagePdf(rawRegion:unknown,png:Buffer){
  const region=PacketImageRegionWorkerSchema.parse(rawRegion);assertImagePdfRgb(region);
  const [width,height]=region.output.pixels,expected=packetImageRegionTransform(region.selection);
  if(width*height>PACKET_IMAGE_PDF_LIMITS.pixels||png.length!==region.output.bytes||sha256(png)!==region.output.sha256||
    canonical(region.transform)!==canonical(expected.transform)||canonical(region.output.pixels)!==canonical(expected.pixels))
    throw new AppError(422,'PACKET_PDF_CROP_INTEGRITY','Use the exact verified image crop bytes and transform.');
  assertCleanImageRegionPng(png,[width,height],'RGB');
  const doc=new jsPDF({unit:'pt',format:[width*.75,height*.75],orientation:width>height?'landscape':'portrait',
    compress:true,putOnlyUsedFonts:true});
  doc.setProperties({title:'Private selected-region packet',subject:PACKET_IMAGE_PDF_RECIPE,creator:'3D ULPIN'});
  doc.setCreationDate("D:20000101000000+00'00'");
  doc.setFileId(region.output.sha256.slice(0,32).toUpperCase());
  doc.addImage(new Uint8Array(png),'PNG',0,0,width*.75,height*.75,undefined,'FAST');
  const bytes=Buffer.from(doc.output('arraybuffer'));
  if(bytes.length>PACKET_IMAGE_PDF_LIMITS.bytes)throw new AppError(413,'PACKET_PDF_OUTPUT_LIMIT','The single-image PDF exceeds 8 MiB.');
  return {bytes,manifest:PacketImagePdfAssemblySchema.parse({version:'packet-image-pdf-assembly/1',recipe:PACKET_IMAGE_PDF_RECIPE,region,
    output:{sha256:sha256(bytes),bytes:bytes.length,contentType:'application/pdf',pages:1,policy:PACKET_IMAGE_PDF_POLICY}})};
}
