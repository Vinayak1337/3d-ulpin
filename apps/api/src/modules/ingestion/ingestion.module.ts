import { Module } from '@nestjs/common';
import { ManualIngestionService } from '@ulpin/server/modules/usp/ingestion/service';
import { IngestionController } from './ingestion.controller';
import { LargeOriginalController } from './large-original.controller';
import { LargeOriginalService } from '@ulpin/server/modules/usp/ingestion/large-original';

@Module({controllers:[IngestionController,LargeOriginalController],providers:[ManualIngestionService,LargeOriginalService]})
export class IngestionModule {}
