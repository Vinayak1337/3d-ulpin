import { Injectable } from '@nestjs/common';
import { decideCanonicalConflict } from '@ulpin/server/modules/officer/canonical-conflict-decisions';
import { retainBuildingCandidates } from '@ulpin/server/modules/usp/ingestion/source-building-candidates';
import { commandLevelSchedule } from '@ulpin/server/modules/officer/level-schedules';
import { exportConsolidatedRegister } from '@ulpin/server/modules/officer/consolidated-register';
import { AppError } from '@ulpin/server/infrastructure/errors';
import type { z } from 'zod';
import { preparationContinuation } from '@ulpin/server/modules/cases/preparation-continuation';
import { buildingDossier, changeAssociation, createBlockGroup, openPreparation } from '@ulpin/server/modules/officer/officer';
import { exportBlock } from '@ulpin/server/modules/officer/block-export';
import { createInvestigation, exportRegister, getInvestigation, updateInvestigation } from '@ulpin/server/modules/officer/officer-investigations';
import {
  appendHumanPreparationFact, physicalFeatureRevisions, propertyDirectory,
  reviewBuildingDetails, workspaceDirectory,
} from '@ulpin/server/modules/officer/officer-operations';
import {
  preparationRequirements, prepareDetails, resolvePreparationFact,
  setPreparationPlacement,
} from '@ulpin/server/modules/officer/officer-preparation';
import { readWorkQueue } from '@ulpin/server/modules/officer/work-queue';
import type {
  associationInput, blockGroupInput, createInvestigationInput, placementInput,
  preparationFactInput, updateInvestigationInput,
} from './input';

@Injectable()
export class OfficerService {
  conflictDecision(buildingId: string, input: unknown) { return decideCanonicalConflict(buildingId, input); }
  candidates(buildingId: string, input: unknown) { return retainBuildingCandidates(buildingId, input); }
  levelSchedule(buildingId: string, input: unknown) { return commandLevelSchedule(buildingId, input); }
  workQueue(url: URL) { return readWorkQueue(url); }
  featureRevisions(id: string, before: number) { return physicalFeatureRevisions(id, before); }
  blockExport(id: string, format: 'json' | 'pdf' | 'zip') { return exportBlock(id, format); }
  propertyDirectory(areaId: string) { return propertyDirectory(areaId); }
  workspaceDirectory() { return workspaceDirectory(); }
  dossier(id: string) { return buildingDossier(id); }
  registerExport(id: string, format: string, investigationId?: string, recordId?: string, profile?: 'consolidated', includeUnrecorded=false) {
    if (profile === 'consolidated') return exportConsolidatedRegister(id, format, recordId, includeUnrecorded);
    if (includeUnrecorded) throw new AppError(422, 'REGISTRY_REPORT_PROFILE', 'Use profile=consolidated for an unrecorded source summary.');
    return exportRegister(id, format, investigationId, recordId);
  }
  openPreparation(id: string, revision: number) { return openPreparation(id, revision); }
  detailReview(id: string, revision: number) { return reviewBuildingDetails(id, revision); }
  association(input: z.infer<typeof associationInput>) { return changeAssociation(input); }
  group(input: z.infer<typeof blockGroupInput>) {
    return createBlockGroup(input as unknown as Parameters<typeof createBlockGroup>[0]);
  }
  continuation(id: string) { return preparationContinuation(id); }
  requirements(id: string) { return preparationRequirements(id); }
  fact(id: string, input: z.infer<typeof preparationFactInput>) { return appendHumanPreparationFact(id, input); }
  resolveFact(id: string, revision: number, claimId: string, reason: string) {
    return resolvePreparationFact(id, revision, claimId, reason);
  }
  placement(id: string, input: z.infer<typeof placementInput>) {
    return setPreparationPlacement(id, input.expectedRevision, input);
  }
  prepareDetails(id: string, revision: number) { return prepareDetails(id, revision); }
  createInvestigation(input: z.infer<typeof createInvestigationInput>) { return createInvestigation(input); }
  investigation(id: string) { return getInvestigation(id); }
  updateInvestigation(id: string, input: z.infer<typeof updateInvestigationInput>) {
    return updateInvestigation(id, input.expectedRevision, input);
  }
  requestEvidence(id: string, revision: number, question: string) {
    return updateInvestigation(id, revision, { question, reason: 'In-app evidence request created.' });
  }
  answerEvidence(id: string, revision: number, requestId: string, response: string,
    evidence?: z.infer<typeof preparationFactInput>['evidence']) {
    return updateInvestigation(id, revision, {
      requestId, response, evidence, reason: 'Response to evidence request recorded.',
    });
  }
}
