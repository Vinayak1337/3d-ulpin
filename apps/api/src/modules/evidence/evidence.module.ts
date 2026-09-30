import { Module } from '@nestjs/common';
import {DocumentAssociationService} from '@ulpin/server/modules/usp/ingestion/document-association';
import {DocumentAssociationController} from './document-association.controller';
import { CityJsonEvidenceController, DecisionEvidenceController, OriginalEvidenceController,
  PacketEvidenceController, SnapshotEvidenceController } from './evidence.controllers';
import { CityJsonEvidenceService, DecisionEvidenceService, OriginalEvidenceService,
  PacketEvidenceService, SnapshotEvidenceService } from './evidence.services';

@Module({
  controllers: [SnapshotEvidenceController, OriginalEvidenceController, DecisionEvidenceController,
    CityJsonEvidenceController, PacketEvidenceController, DocumentAssociationController],
  providers: [SnapshotEvidenceService, OriginalEvidenceService, DecisionEvidenceService,
    CityJsonEvidenceService, PacketEvidenceService, DocumentAssociationService],
})
export class EvidenceModule {}
