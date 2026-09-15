import type {
  CoordinateFrame,
  ComputedUnit,
  Finding,
  Point2,
  SourceBinding,
  SourceRevision,
} from "./index";
export type RegistryKind = "parcel" | "building" | "floor" | "space";
export type SpaceUse = "apartment" | "common" | "basement" | "utility" | "unspecified";
export interface RegistryRight {
  party: string;
  type: "ownership_claim" | "shared_use" | "easement";
  evidence: SourceBinding;
}
export interface RegistryLink {
  targetId: string;
  type: "within" | "floor" | "serves" | "crosses";
}
export interface RegistryBody {
  alias: string;
  name: string;
  kind: RegistryKind;
  use?: SpaceUse;
  footprint: Point2[];
  geometry?: Omit<ComputedUnit, "area" | "height" | "volume"> &
    Partial<Pick<ComputedUnit, "area" | "height" | "volume">>;
  links: RegistryLink[];
  rights: RegistryRight[];
  evidence: SourceBinding[];
  officialUlpin?: string;
  synthetic: boolean;
}
export interface RegistryRecord extends RegistryBody {
  id: string;
  siteId: string;
  identifier: string;
  revision: number;
}
export interface RegistrySite {
  id: string;
  identifier: string;
  name: string;
  frame: CoordinateFrame;
  revision: number;
  synthetic: boolean;
}
export interface RegistryDetail {
  site: RegistrySite;
  records: RegistryRecord[];
  sources: SourceRevision[];
  drafts: RegistryDraft[];
}
export interface RegistryDraft {
  id: string;
  siteId: string;
  caseId: string;
  revision: number;
  status: "draft" | "recorded";
  records: RegistryRecord[];
  createdAt: string;
}
export interface RegistryReview {
  preparationFingerprint?: string;
  id: string;
  draftId: string;
  draftRevision: number;
  siteRevision: number;
  findings: Finding[];
  records: RegistryRecord[];
  before: RegistryRecord[];
  inputFingerprint: string;
  committed: boolean;
  acknowledgement?: string;
}
export interface RegistryQuery {
  siteId: string;
  registryRevision: number;
  frame: CoordinateFrame;
  synthetic: boolean;
  mode: "point" | "volume";
  input:
    | { mode: "point"; point: Point2 }
    | { mode: "volume"; footprint: Point2[]; lower: number; upper: number };
  results: {
    record: RegistryRecord;
    contact: boolean;
    volume: number;
    overlaps: {
      footprint: Point2[];
      lower: number;
      upper: number;
      volume: number;
    }[];
  }[];
}
