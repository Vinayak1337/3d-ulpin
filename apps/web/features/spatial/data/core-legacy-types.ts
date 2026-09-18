import type {AreaReference,CoordinateFrame,PhysicalFeature,RegistryRecord,SourceRevision,WorldState} from "@ulpin/contracts";

export type LegacySourceMetadata=Pick<SourceRevision,"id"|"caseId"|"familyId"|"revision"|"name"|"profile"|"mimeType"|"bytes"|"sha256">;
export type LegacyRegistryRecord=Omit<RegistryRecord,"rights">;
export interface LegacyReadArea {
  id:string;siteId:string;revision:number;name:string;reference:AreaReference|null;
}
export interface LegacyReadSite {
  id:string;identifier:string;name:string;revision:number;frame:CoordinateFrame;synthetic:boolean;
}
export interface LegacyReadFeature {
  id:string;revision:number;ownerAreaId:string;recordId:string|null;
  ownerReference:AreaReference|null;memberAreaIds:readonly string[];body:PhysicalFeature;
}
/** A server-private, sanitized read slice, not an arbitrary JSON import profile. */
export interface LegacySpatialReadSlice {
  schemaVersion:"ulpin-legacy-read/1";
  area:LegacyReadArea;sites:readonly LegacyReadSite[];
  features:readonly LegacyReadFeature[];records:readonly LegacyRegistryRecord[];
  sources:readonly LegacySourceMetadata[];
}
export interface CoreLegacyDiagnostic {
  code:string;target:{namespace:string;id:string};message:string;
}
export const CORE_LEGACY_LIMITS={features:512,records:1024,sources:512,sites:64,inputBytes:12*1024*1024,outputBytes:16*1024*1024} as const;
export interface LegacyReadOptions {world:WorldState;expectedDigest?:string}
