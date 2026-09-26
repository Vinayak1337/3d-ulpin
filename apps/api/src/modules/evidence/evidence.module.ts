import { Module } from '@nestjs/common';
import { CityJsonEvidenceController, DecisionEvidenceController, OriginalEvidenceController,
  PacketEvidenceController, SnapshotEvidenceController } from './evidence.controllers';
import { CityJsonEvidenceService, DecisionEvidenceService, OriginalEvidenceService,
  PacketEvidenceService, SnapshotEvidenceService } from './evidence.services';

@Module({
  controllers: [SnapshotEvidenceController, OriginalEvidenceController, DecisionEvidenceController,
    CityJsonEvidenceController, PacketEvidenceController],
  providers: [SnapshotEvidenceService, OriginalEvidenceService, DecisionEvidenceService,
    CityJsonEvidenceService, PacketEvidenceService],
})
export class EvidenceModule {}
