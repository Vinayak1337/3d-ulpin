import { Module } from '@nestjs/common';
import { AreaIntakeService } from '@ulpin/server/modules/areas/area-intake-service';
import { CaseIntakeService } from '@ulpin/server/modules/cases/case-intake-service';
import { AreaSourcesController } from './area-sources.controller';
import { CasesController } from './cases.controller';
import { ImportPackagesController } from './import-packages.controller';

@Module({
  controllers: [CasesController, AreaSourcesController, ImportPackagesController],
  providers: [CaseIntakeService, AreaIntakeService],
})
export class IntakeModule {}
