import {z} from 'zod';
import {zipSync} from 'fflate';
import type {RequestContext} from '@ulpin/contracts/usp';
import {PACKET_PDF_BUNDLE_LIMITS,PacketPdfBundleManifestSchema} from '../../../../../contracts/src/usp/packet-pdf-bundle';
import {PACKET_PDF_LIMITS,PACKET_PDF_MULTI_LIMITS,UspAnyPacketPdfReceiptSchema} from '../../../../../contracts/src/usp/packet-pdf';
import {transaction} from '../../../infrastructure/db';
import {AppError,conflict} from '../../../infrastructure/errors';
import {sha256} from '../../../infrastructure/storage';
import {canonical,fingerprint} from '../../cases/domain';
import {assertLocalUsp} from '../snapshots';
import {capturePacketPdfTx,pdfPacketStorage,pdfExecutionLive,type PdfPacketIo} from './pdf-service';
import {validateExecution} from './plan-store';

type Capture=Awaited<ReturnType<typeof capturePacketPdfTx>>;
/** Internal test/I/O seams only; default capture always reuses complete canonical authority. */
export type PdfBundleDependencies={capture:(ctx:RequestContext,packetId:string,deadlineAt:number)=>Promise<Capture>;
  read:PdfPacketIo['read']};
const defaults:PdfBundleDependencies={read:pdfPacketStorage.read,
  capture:(ctx,packetId,deadlineAt)=>transaction(client=>capturePacketPdfTx(client,ctx,packetId),{deadlineAt})};

export function packetPdfBundleManifest(captured:Capture){
  const parsed=UspAnyPacketPdfReceiptSchema.safeParse(captured.receipt);
  if(!parsed.success)throw new AppError(422,'PACKET_PDF_BUNDLE_UNSUPPORTED','This PDF receipt has no supported bundle representation.');
  const receipt=parsed.data,plan=captured.view.plan;
  const execution=validateExecution(plan,captured.view.execution);
  if(canonical(execution.packet)!==canonical(receipt))conflict('The bundle differs from the exact accepted PDF execution.');
  const regions=receipt.version==='packet-pdf/1'?[receipt.assembly.region]:receipt.assembly.regions;
  return PacketPdfBundleManifestSchema.parse({version:'packet-pdf-bundle-manifest/1',representation:'private_accepted_packet_download',
    packet:{packetId:receipt.packetId,receiptVersion:receipt.version,receiptSha256:fingerprint(receipt),createdAt:receipt.createdAt,
      target:receipt.target,scope:receipt.scope,plan:{planId:receipt.planId,version:receipt.planVersion,sha256:receipt.planSha256},
      confirmationId:receipt.confirmationId,targetBodySha256:plan.targetBodySha256,recipe:receipt.assembly.recipe},
    pdf:{filename:'packet.pdf',sha256:receipt.assembly.output.sha256,bytes:receipt.assembly.output.bytes,
      pages:receipt.assembly.output.pages,contentType:receipt.contentType,policy:receipt.assembly.output.policy},
    entries:plan.entries.map((entry,index)=>{const binding=entry.binding!;return {outputPage:index+1,required:true,
      bindingId:binding.id,entrySha256:entry.entrySha256,applicabilitySha256:entry.applicabilitySha256,
      associationState:binding.associationState,qualification:binding.qualification,
      source:{sha256:binding.document.sourceSha256,revision:binding.document.sourceRevision,bytes:binding.document.sourceBytes},
      derivative:regions[index]};}),
    qualification:{documentRole:'generated_compilation',certifiedOriginal:false,titleDetermination:'unsupported',officialIssuance:'unsupported',
      propertyMatching:'not_assessed',geometry:'not_assessed',sourcePermissions:'not_assessed',learning:'not_assessed'}});
}
/** Fixed stored entries and fixed DOS timestamps. No caller path, source read,
 * compression, persistent object or database write is introduced. */
export async function readPacketPdfBundle(ctx:RequestContext,packetValue:string,dependencies:PdfBundleDependencies=defaults){
  assertLocalUsp(ctx);const packetId=z.uuid().parse(packetValue),deadlineAt=Date.now()+PACKET_PDF_BUNDLE_LIMITS.seconds*1000;
  const before=await dependencies.capture(ctx,packetId,deadlineAt);pdfExecutionLive(deadlineAt);
  const manifest=packetPdfBundleManifest(before),manifestBytes=Buffer.from(canonical(manifest)),output=before.receipt.assembly.output;
  if(manifestBytes.length>PACKET_PDF_BUNDLE_LIMITS.manifestBytes)
    throw new AppError(413,'PACKET_PDF_BUNDLE_MANIFEST_LIMIT','The selected packet provenance exceeds the 64 KiB bundle manifest limit.');
  const pdfLimit=before.receipt.version==='packet-pdf/1'?PACKET_PDF_LIMITS.bytes:PACKET_PDF_MULTI_LIMITS.bytes;
  if(!Number.isSafeInteger(output.bytes)||output.bytes<1||output.bytes>pdfLimit)
    throw new AppError(422,'PACKET_PDF_ARTIFACT_INTEGRITY','The saved PDF exceeds its bounded receipt.');
  // Fixed filenames with no comments/extra fields: local headers + central directory + EOCD.
  const overhead=22+2*(30+46)+'packet.pdf'.length*2+'manifest.json'.length*2;
  if(output.bytes+manifestBytes.length+overhead>PACKET_PDF_BUNDLE_LIMITS.archiveBytes)
    throw new AppError(413,'PACKET_PDF_BUNDLE_LIMIT','The completed packet exceeds the 34 MiB bundle limit.');
  const pdf=await dependencies.read(before.key,output.bytes,output.sha256,deadlineAt);pdfExecutionLive(deadlineAt);
  if(pdf.length!==output.bytes||pdf.length>pdfLimit||sha256(pdf)!==output.sha256)
    throw new AppError(422,'PACKET_PDF_ARTIFACT_INTEGRITY','The saved PDF differs from its exact receipt.');
  const options={level:0 as const,mtime:new Date(1980,0,1),os:0,attrs:0},
    bytes=zipSync({'packet.pdf':[pdf,options],'manifest.json':[manifestBytes,options]},options);pdfExecutionLive(deadlineAt);
  if(bytes.length>PACKET_PDF_BUNDLE_LIMITS.archiveBytes)
    throw new AppError(413,'PACKET_PDF_BUNDLE_LIMIT','The completed packet exceeds the 34 MiB bundle limit.');
  const archiveSha256=sha256(bytes),manifestSha256=sha256(manifestBytes);pdfExecutionLive(deadlineAt);
  // Archive assembly and artifact I/O are outside SQL; recapture before disclosure.
  const after=await dependencies.capture(ctx,packetId,deadlineAt);pdfExecutionLive(deadlineAt);
  if(canonical(after)!==canonical(before))conflict('The accepted PDF or complete private authority changed during bundle assembly.');
  return {bytes,packetId,manifest,manifestBytes,sha256:archiveSha256,manifestSha256};
}
