import { CityJSONControlReviewController } from './cityjson-control-review.controller';
import { CityJSONControlReviewService } from '@ulpin/server/modules/registry/cityjson-control-review';
import { Module } from '@nestjs/common';
import { RegisterController } from './register.controller';
import { OfficerController } from './officer.controller';
import { RegisterService } from './register.service';
import { OfficerService } from './officer.service';
import { BuildingLedgerController } from './building-ledger.controller';
import { CityJSONControlAssessmentController } from './cityjson-control-assessment.controller';
import { CityJSONControlAssessmentService } from '@ulpin/server/modules/registry/cityjson-control-assessment';

@Module({
  controllers: [RegisterController, OfficerController, BuildingLedgerController, CityJSONControlAssessmentController, CityJSONControlReviewController],
  providers: [RegisterService, OfficerService, CityJSONControlAssessmentService, CityJSONControlReviewService],
})
export class RegisterModule {}
