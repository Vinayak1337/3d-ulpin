import { Injectable } from '@nestjs/common';
import type { z } from 'zod';
import type {
  AssignProjectCodeSchema, ProjectIdentityMutationSchema, ProjectIdentityReviewSchema,
  ResolveProjectIdentitySchema, UspCaptureSnapshotRequestSchema, UspCommitProposalSchema,
  UspExchangeCompareSchema, UspExchangeExportSchema, UspPacket0RequestSchema,
  UspPrepareProposalSchema, UspReadEvidenceRequestSchema, UspReadScopeRequestSchema,
  UspResolveTargetRequestSchema, UspSnapshotScopeSchema, UspVerticalSelectionSchema,
} from '@ulpin/contracts/usp';
import { AppError } from '@ulpin/server/infrastructure/errors';
import { localRequestContext } from '@ulpin/server/modules/usp/principal';
import { captureRegistrySnapshot, readManifest, readRegistryScope,
  resolveRegistryTarget, resolveRegistryVerticalContext, readRegistryEvidenceBytes,
} from '@ulpin/server/modules/usp/snapshots';
import { prepareProposal, commitProposal } from '@ulpin/server/modules/usp/commands';
import { readExactPart, createPacket0, readPacket0, readPacket0Receipt } from '@ulpin/server/modules/usp/packet0';
import { prepareProjectIdentityReview, assignProjectCode, mutateProjectIdentity,
  resolveProjectIdentity } from '@ulpin/server/modules/usp/project-identity';
import { exportCityJson, compareCityJson } from '@ulpin/server/modules/usp/exchange';

type Capture = z.output<typeof UspCaptureSnapshotRequestSchema>;
type SnapshotScope = z.output<typeof UspSnapshotScopeSchema>;
type ScopeRead = z.output<typeof UspReadScopeRequestSchema>;
type ResolveTarget = z.output<typeof UspResolveTargetRequestSchema>;
type Vertical = z.output<typeof UspVerticalSelectionSchema>;
type EvidenceRead = z.output<typeof UspReadEvidenceRequestSchema>;
type Prepare = z.output<typeof UspPrepareProposalSchema>;
type Commit = z.output<typeof UspCommitProposalSchema>;
type Review = z.output<typeof ProjectIdentityReviewSchema>;
type Assign = z.output<typeof AssignProjectCodeSchema>;
type Mutation = z.output<typeof ProjectIdentityMutationSchema>;
type IdentityResolve = z.output<typeof ResolveProjectIdentitySchema>;
type CityExport = z.output<typeof UspExchangeExportSchema>;
type CityCompare = z.output<typeof UspExchangeCompareSchema>;
type PacketCreate = z.output<typeof UspPacket0RequestSchema>;

@Injectable()
export class SnapshotEvidenceService {
  async capture(requestId: string, input: Capture) {
    if (input.stage !== 'recorded' || input.world.id !== `registry-site/${input.scopeId}`) {
      throw new AppError(422, 'USP_SNAPSHOT_PROFILE', 'This recorded registry scope is unavailable.');
    }
    return captureRegistrySnapshot(localRequestContext(requestId), input.scopeId, input.selection);
  }
  read(requestId: string, scope: SnapshotScope) {
    return readManifest(localRequestContext(requestId), scope);
  }
  scope(requestId: string, input: ScopeRead) {
    return readRegistryScope(localRequestContext(requestId), input.scope, input.cursor, input.limit);
  }
  resolve(requestId: string, input: ResolveTarget) {
    return resolveRegistryTarget(localRequestContext(requestId), input.scope, input.pin);
  }
  vertical(requestId: string, input: Vertical) {
    return resolveRegistryVerticalContext(localRequestContext(requestId), input.scope,
      input.building, input.floor, input.space);
  }
}

@Injectable()
export class OriginalEvidenceService {
  original(requestId: string, input: EvidenceRead) {
    if (input.action !== 'original') throw new AppError(422, 'USP_EVIDENCE_ACTION', 'Choose the original action.');
    return readRegistryEvidenceBytes(localRequestContext(requestId), input.scope, input.pointer);
  }
  part(requestId: string, input: EvidenceRead) {
    if (input.action !== 'extract') throw new AppError(422, 'USP_EVIDENCE_ACTION', 'Choose the extract action.');
    return readExactPart(localRequestContext(requestId), input.scope, input.pointer);
  }
}

@Injectable()
export class DecisionEvidenceService {
  prepare(requestId: string, input: Prepare) {
    return prepareProposal(localRequestContext(requestId), input);
  }
  commit(requestId: string, input: Commit) {
    return commitProposal(localRequestContext(requestId), input);
  }
  review(requestId: string, input: Review) {
    return prepareProjectIdentityReview(localRequestContext(requestId), input);
  }
  assign(requestId: string, input: Assign) {
    return assignProjectCode(localRequestContext(requestId), input);
  }
  mutate(requestId: string, input: Mutation) {
    return mutateProjectIdentity(localRequestContext(requestId), input);
  }
  resolveIdentity(requestId: string, input: IdentityResolve) {
    return resolveProjectIdentity(localRequestContext(requestId), input);
  }
}

@Injectable()
export class CityJsonEvidenceService {
  export(requestId: string, input: CityExport) {
    return exportCityJson(localRequestContext(requestId), input);
  }
  compare(requestId: string, input: CityCompare) {
    return compareCityJson(localRequestContext(requestId), input);
  }
}

@Injectable()
export class PacketEvidenceService {
  create(requestId: string, input: PacketCreate) {
    return createPacket0(localRequestContext(requestId), input);
  }
  read(requestId: string, packetId: string) {
    return readPacket0(localRequestContext(requestId), packetId);
  }
  receipt(requestId: string, packetId: string) {
    return readPacket0Receipt(localRequestContext(requestId), packetId);
  }
}
