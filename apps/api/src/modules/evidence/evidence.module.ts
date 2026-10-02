import { Module } from '@nestjs/common';
import {DocumentAssociationService} from '@ulpin/server/modules/usp/ingestion/document-association';
import {DocumentAssociationController} from './document-association.controller';
import {DocumentPagesService} from '@ulpin/server/modules/usp/ingestion/document-pages';
import {DocumentPagesController} from './document-pages.controller';
import {DocumentImagesService} from '@ulpin/server/modules/usp/ingestion/document-images';
import {DocumentImagesController} from './document-images.controller';
import {SourceFusionService} from '@ulpin/server/modules/usp/ingestion/source-fusion';
import {SourceFusionController} from './source-fusion.controller';
import {SourceFusionAssociationService} from '@ulpin/server/modules/usp/ingestion/source-fusion-associations';
import {SourceFusionAssociationsController} from './source-fusion-associations.controller';
import {DeclarationsController} from './declarations.controller';
import {PacketPlansController} from './packet-plans.controller';
import {PropertyCardController} from './property-card.controller';
import { CityJsonEvidenceController, DecisionEvidenceController, OriginalEvidenceController,
  PacketEvidenceController, SnapshotEvidenceController } from './evidence.controllers';
import { CityJsonEvidenceService, DecisionEvidenceService, OriginalEvidenceService,
  PacketEvidenceService, SnapshotEvidenceService } from './evidence.services';

@Module({
  controllers: [SnapshotEvidenceController, OriginalEvidenceController, DecisionEvidenceController,
    CityJsonEvidenceController, PacketEvidenceController, PacketPlansController, PropertyCardController, DocumentAssociationController, DocumentPagesController, DocumentImagesController, SourceFusionController, SourceFusionAssociationsController, DeclarationsController],
  providers: [SnapshotEvidenceService, OriginalEvidenceService, DecisionEvidenceService,
    CityJsonEvidenceService, PacketEvidenceService, DocumentAssociationService, DocumentPagesService, DocumentImagesService, SourceFusionService, SourceFusionAssociationService],
})
export class EvidenceModule {}
