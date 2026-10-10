import { Module } from '@nestjs/common';
import { DatasetSearchController, DatasetsController } from './datasets.controller';
import { SpatialMlController } from './spatial-ml.controller';
import { SpatialSourceReviewsController } from './spatial-ml-source-review.controller';
import { SpatialSourceReviewsService } from '@ulpin/server/modules/spatial/spatial-ml-source-review';
import { SpatialAreaController, SpatialCoreController, SpatialCalibrationController } from './spatial-core.controller';
import { PrivateSpatialGuard } from './private-spatial.guard';

@Module({
  providers: [PrivateSpatialGuard, SpatialSourceReviewsService],
  controllers: [
    DatasetSearchController, DatasetsController, SpatialMlController, SpatialSourceReviewsController,
    SpatialAreaController, SpatialCoreController, SpatialCalibrationController,
  ],
})
export class SpatialModule {}
