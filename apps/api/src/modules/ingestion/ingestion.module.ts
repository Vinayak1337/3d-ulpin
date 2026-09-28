import { Module } from '@nestjs/common';
import { ManualIngestionService } from '@ulpin/server/modules/usp/ingestion/service';
import { IngestionController } from './ingestion.controller';
import { LargeOriginalController } from './large-original.controller';
import { LargeOriginalService } from '@ulpin/server/modules/usp/ingestion/large-original';
import { IngestionEventsController } from './events.controller';
import {ProjectedVectorController} from './projected-vector.controller';
import {ProjectedVectorService} from '@ulpin/server/modules/usp/ingestion/projected-vector';
import {PrivateMvtController} from './private-mvt.controller';
import {SemanticChunkService} from '@ulpin/server/modules/usp/ingestion/semantic-chunks';
import {PrivateMvtService} from '@ulpin/server/modules/usp/tiles/service';
import {IngestionSufficiencyService} from '@ulpin/server/modules/usp/ingestion/sufficiency';
import {SufficiencyController} from './sufficiency.controller';
import {DocumentIngestionService} from '@ulpin/server/modules/usp/ingestion/documents';
import {DocumentsController} from './documents.controller';
import {AdaptiveMappingService} from '@ulpin/server/modules/usp/ingestion/adaptive-mapping-service';
import {AdaptiveMappingController} from './adaptive-mapping.controller';

@Module({controllers:[IngestionController,LargeOriginalController,IngestionEventsController,ProjectedVectorController,PrivateMvtController,DocumentsController,SufficiencyController,AdaptiveMappingController],providers:[ManualIngestionService,LargeOriginalService,ProjectedVectorService,PrivateMvtService,SemanticChunkService,DocumentIngestionService,IngestionSufficiencyService,AdaptiveMappingService]})
export class IngestionModule {}
