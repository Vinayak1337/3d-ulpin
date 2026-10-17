import {z} from 'zod';
import {KMLMemberPinSchema,type KMLResult} from '@ulpin/contracts/usp';
import {SourceFusionKMLSchema,SourceFusionLiteralObjectSchema,SourceFusionLiteralJsonSchema,
  type SourceFusionContext,type SourceFusionSelection} from '../../../../../contracts/src/source-fusion';
import {AppError} from '../../../infrastructure/errors';
import {fingerprint} from '../../cases/domain';

const fail=():never=>{throw new AppError(422,'SOURCE_FUSION_SELECTION','The requested accepted KML feature selection is unavailable.');};
const nativeSchema=z.object({schemaVersion:z.literal('kml-native-inspection/1'),sourceSha256:z.string(),sourceBytes:z.number(),
  container:z.enum(['kml','kmz']),status:z.enum(['inspected','partial','needs_input']),xmlSha256:z.string().nullable(),
  member:SourceFusionLiteralObjectSchema.nullable(),memberInventory:z.array(SourceFusionLiteralObjectSchema).max(256),
  document:SourceFusionLiteralObjectSchema.nullable(),features:z.array(SourceFusionLiteralObjectSchema).max(10000),
  unsupported:z.array(SourceFusionLiteralJsonSchema).max(100000),references:z.array(SourceFusionLiteralJsonSchema).max(100000),
  coordinateCount:z.number().int().nonnegative().max(100000),qualification:SourceFusionLiteralObjectSchema});
const memberPin=(member:Record<string,unknown>|null)=>member?KMLMemberPinSchema.parse({path:member.path,
  ordinal:member.ordinal,sha256:member.sha256,bytes:member.bytes}):null;

/** Exact accepted artifact records. Parents remain native ordinal references;
 * no unselected feature expansion, link resolution or coordinate transform. */
export function fusionKMLSourceProjection(selection:Extract<SourceFusionSelection,{kind:'kml'}>,
  loaded:{result:KMLResult;native:unknown}):Extract<SourceFusionContext['sources'][number],{kind:'kml'}>{
  const {input,summary,artifact}=loaded.result,pin=selection.pin,ordinals=selection.featureOrdinals;
  if(!ordinals.length||ordinals.length>25||new Set(ordinals).size!==ordinals.length||
    ordinals.some(n=>!Number.isSafeInteger(n)||n<0||n>9999))return fail();
  if(input.caseId!==pin.caseId||input.caseRevision!==pin.caseRevision||input.sourceId!==pin.sourceId||
    input.sourceRevision!==pin.sourceRevision||input.sourceSha256!==pin.sourceSha256||input.jobId!==pin.jobId||
    input.readerSha256!==pin.readerSha256||fingerprint(input)!==pin.inputSha256)return fail();
  const native=nativeSchema.parse(loaded.native),member=memberPin(native.member);
  if(native.sourceSha256!==input.sourceSha256||native.sourceBytes!==input.sourceBytes||
    summary.sourceSha256!==native.sourceSha256||summary.sourceBytes!==native.sourceBytes||summary.container!==native.container||
    summary.status!==native.status||summary.xmlSha256!==native.xmlSha256||fingerprint(summary.member)!==fingerprint(member)||
    summary.featureCount!==native.features.length||summary.coordinateCount!==native.coordinateCount||
    summary.unsupportedCount!==native.unsupported.length||summary.unresolvedReferenceCount!==native.references.length||
    fingerprint(summary.members)!==fingerprint(native.memberInventory.filter(v=>v.kind==='kml').map(memberPin))||
    native.qualification.profile!=='local_source_inspection'||native.qualification.accuracy!=='not_assessed'||
    native.qualification.analyticEligible!==false||native.qualification.registryAdmission!==false||native.qualification.learningLabels!==false)return fail();
  if(summary.status==='needs_input')throw new AppError(422,
    summary.selectionCode==='KML_MEMBER_SELECTION_REQUIRED'?'SOURCE_FUSION_KML_MEMBER_SELECTION_REQUIRED':'SOURCE_FUSION_KML_NO_MEMBER',
    summary.selectionCode==='KML_MEMBER_SELECTION_REQUIRED'
      ?'Select an exact archive member through the canonical KML retry operation before selecting features.'
      :'This archive has no selectable KML member; retain a supported source before selecting features.');
  if(!native.document||!native.xmlSha256||native.document.profile!==summary.documentProfile||
    native.xmlSha256!==(member?.sha256??input.sourceSha256)||input.selection&&fingerprint(input.selection)!==fingerprint(member))return fail();
  const sorted=[...ordinals].sort((a,b)=>a-b),features=sorted.map(ordinal=>{
    const record=native.features[ordinal];
    if(!record||record.ordinal!==ordinal||typeof record.type!=='string'||
      !record.locator||typeof record.locator!=='object'||Array.isArray(record.locator)||
      !Array.isArray(record.geometries)||!Array.isArray(record.sourceFields))return fail();
    return {ordinal,pointer:`/features/${ordinal}`,recordSha256:fingerprint(record),record};
  });
  return SourceFusionKMLSchema.parse({kind:'kml',pin,
    namespace:`source:${pin.caseId}/${pin.sourceId}@${pin.sourceRevision}`,sourceSetRole:'operator_selected_fragment',
    summary,artifactSha256:artifact.sha256,artifactBytes:artifact.bytes,
    selectionSha256:fingerprint({version:'source-fusion-kml-selection/1',sourceSha256:input.sourceSha256,
      member,xmlSha256:native.xmlSha256,artifact:{sha256:artifact.sha256,bytes:artifact.bytes},featureOrdinals:sorted}),
    selectionHashBasis:'original_member_xml_artifact_and_sorted_feature_ordinals',
    nativeIdentifierScope:'source_native_only; not_canonical_registry_ids',document:native.document,
    memberInventory:native.memberInventory,features,findings:{unsupported:native.unsupported,references:native.references},
    qualification:native.qualification,coverage:{selectedFeatures:features.length,availableNativeFeatures:native.features.length,
      scope:'explicit_feature_records; source_document_member_metadata_and_findings',unselectedFeatures:'not_expanded',
      referenceResolution:'not_performed',geometryQualification:'not_assessed',propertyMatching:'unsupported'}});
}
