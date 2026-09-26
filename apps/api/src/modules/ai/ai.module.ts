import { Module } from '@nestjs/common';
import { AiStatusController, OfficerAiController } from './ai.controller';
import { PrivateSpatialGuard } from '../spatial/private-spatial.guard';

@Module({ controllers: [AiStatusController, OfficerAiController], providers: [PrivateSpatialGuard] })
export class AiModule {}
