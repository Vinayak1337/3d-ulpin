import type { Type } from '@nestjs/common';
import { IntakeModule } from './modules/intake/intake.module';
import { RegisterModule } from './modules/register/register.module';
import { EvidenceModule } from './modules/evidence/evidence.module';
import { SpatialModule } from './modules/spatial/spatial.module';
import { AiModule } from './modules/ai/ai.module';
import { IngestionModule } from './modules/ingestion/ingestion.module';

/** One lead-owned registration seam after each domain controller batch is accepted. */
export const domainModules: Type<unknown>[] = [IntakeModule, RegisterModule, EvidenceModule, SpatialModule, AiModule, IngestionModule];
