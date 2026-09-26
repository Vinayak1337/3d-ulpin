import { Module } from '@nestjs/common';
import { DatasetSearchController, DatasetsController } from './datasets.controller';
import { SpatialMlController } from './spatial-ml.controller';
import { SpatialAreaController, SpatialCoreController, SpatialCalibrationController } from './spatial-core.controller';
import { PrivateSpatialGuard } from './private-spatial.guard';

@Module({
  providers: [PrivateSpatialGuard],
  controllers: [
    DatasetSearchController, DatasetsController, SpatialMlController,
    SpatialAreaController, SpatialCoreController, SpatialCalibrationController,
  ],
})
export class SpatialModule {}
