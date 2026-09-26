import { Module } from '@nestjs/common';
import { ManualIngestionService } from '@ulpin/server/modules/usp/ingestion/service';
import { IngestionController } from './ingestion.controller';

@Module({controllers:[IngestionController],providers:[ManualIngestionService]})
export class IngestionModule {}
