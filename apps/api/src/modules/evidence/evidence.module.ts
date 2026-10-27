import { Module } from '@nestjs/common';
import {SurveyReportService} from '@ulpin/server/modules/usp/ingestion/survey-report';
import {SurveyReportController} from './survey-report.controller';
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
import {IdentityReviewsController} from './identity-reviews.controller';
import {PacketPlansController} from './packet-plans.controller';
import {PacketBundleController} from './packet-bundle.controller';
import {PropertyCardController} from './property-card.controller';
import {PacketRegionController} from './packet-region.controller';
import {PacketImageRegionController} from './packet-image-region.controller';
import {PacketImageRegionService} from '@ulpin/server/modules/usp/packets/image-region';
import {PacketRegionService} from '@ulpin/server/modules/usp/packets/region-extract';
import { CityJsonEvidenceController, DecisionEvidenceController, OriginalEvidenceController,
  PacketEvidenceController, SnapshotEvidenceController } from './evidence.controllers';
import { CityJsonEvidenceService, DecisionEvidenceService, OriginalEvidenceService,
  PacketEvidenceService, SnapshotEvidenceService } from './evidence.services';

@Module({
  controllers: [SurveyReportController, SnapshotEvidenceController, OriginalEvidenceController, DecisionEvidenceController,
    IdentityReviewsController,
    CityJsonEvidenceController, PacketEvidenceController, PacketPlansController, PacketBundleController, PropertyCardController, PacketRegionController, PacketImageRegionController, DocumentAssociationController, DocumentPagesController, DocumentImagesController, SourceFusionController, SourceFusionAssociationsController, DeclarationsController],
  providers: [SurveyReportService, SnapshotEvidenceService, OriginalEvidenceService, DecisionEvidenceService,
    CityJsonEvidenceService, PacketEvidenceService, PacketRegionService, PacketImageRegionService, DocumentAssociationService, DocumentPagesService, DocumentImagesService, SourceFusionService, SourceFusionAssociationService],
})
export class EvidenceModule {}
