import { Module } from '@nestjs/common';
import { ManualIngestionService } from '@ulpin/server/modules/usp/ingestion/service';
import { IngestionController } from './ingestion.controller';
import { LargeOriginalController } from './large-original.controller';
import { LargeOriginalService } from '@ulpin/server/modules/usp/ingestion/large-original';
import { IngestionEventsController } from './events.controller';
import {ProjectedVectorController} from './projected-vector.controller';
import {ProjectedVectorService} from '@ulpin/server/modules/usp/ingestion/projected-vector';

@Module({controllers:[IngestionController,LargeOriginalController,IngestionEventsController,ProjectedVectorController],providers:[ManualIngestionService,LargeOriginalService,ProjectedVectorService]})
export class IngestionModule {}
