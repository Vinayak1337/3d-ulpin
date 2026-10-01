import { Module } from '@nestjs/common';
import {DocumentAssociationService} from '@ulpin/server/modules/usp/ingestion/document-association';
import {DocumentAssociationController} from './document-association.controller';
import {DocumentPagesService} from '@ulpin/server/modules/usp/ingestion/document-pages';
import {DocumentPagesController} from './document-pages.controller';
import {DocumentImagesService} from '@ulpin/server/modules/usp/ingestion/document-images';
import {DocumentImagesController} from './document-images.controller';
import {SourceFusionService} from '@ulpin/server/modules/usp/ingestion/source-fusion';
import {SourceFusionController} from './source-fusion.controller';
import {DeclarationsController} from './declarations.controller';
import { CityJsonEvidenceController, DecisionEvidenceController, OriginalEvidenceController,
  PacketEvidenceController, SnapshotEvidenceController } from './evidence.controllers';
import { CityJsonEvidenceService, DecisionEvidenceService, OriginalEvidenceService,
  PacketEvidenceService, SnapshotEvidenceService } from './evidence.services';

@Module({
  controllers: [SnapshotEvidenceController, OriginalEvidenceController, DecisionEvidenceController,
    CityJsonEvidenceController, PacketEvidenceController, DocumentAssociationController, DocumentPagesController, DocumentImagesController, SourceFusionController, DeclarationsController],
  providers: [SnapshotEvidenceService, OriginalEvidenceService, DecisionEvidenceService,
    CityJsonEvidenceService, PacketEvidenceService, DocumentAssociationService, DocumentPagesService, DocumentImagesService, SourceFusionService],
})
export class EvidenceModule {}
