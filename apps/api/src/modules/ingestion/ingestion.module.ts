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
import {DocumentClaimsController} from './document-claims.controller';
import {DocumentClaimsService} from '@ulpin/server/modules/usp/ingestion/document-claims';
import {DocumentProposalsController} from './document-proposals.controller';
import {DocumentProposalsService} from '@ulpin/server/modules/usp/ingestion/document-proposals';
import {AdaptiveMappingService} from '@ulpin/server/modules/usp/ingestion/adaptive-mapping-service';
import {AdaptiveMappingController} from './adaptive-mapping.controller';
import {StreamingVectorController} from './streaming-vector.controller';
import {StreamingVectorService} from '@ulpin/server/modules/usp/ingestion/streaming-vector';
import {ChunkMappingController} from './chunk-mapping.controller';
import {ChunkMappingService} from '@ulpin/server/modules/usp/ingestion/chunk-mapping';
import {StreamedProfileController} from './streamed-profile.controller';
import {StreamedProfileService} from '@ulpin/server/modules/usp/ingestion/streamed-profile';
import {StreamedMappingService} from '@ulpin/server/modules/usp/ingestion/streamed-mapping';
import {RasterWindowController} from './raster-window.controller';
import {RasterWindowService} from '@ulpin/server/modules/usp/ingestion/raster-window';
import {PointBatchController} from './point-batch.controller';
import {PointBatchService} from '@ulpin/server/modules/usp/ingestion/point-batch';

import {CityJSONController} from './cityjson.controller';
import {CityJSONIngestionService} from '@ulpin/server/modules/usp/ingestion/cityjson';

import {IFCController} from './ifc.controller';
import {IFCIngestionService} from '@ulpin/server/modules/usp/ingestion/ifc';
import {CityGMLController} from './citygml.controller';
import {CityGMLIngestionService} from '@ulpin/server/modules/usp/ingestion/citygml';
import {GltfController} from './gltf.controller';
import {GltfIngestionService} from '@ulpin/server/modules/usp/ingestion/gltf';
import {ObjController} from './obj.controller';
import {ObjIngestionService} from '@ulpin/server/modules/usp/ingestion/obj';
import {GeoParquetController} from './geoparquet.controller';
import {GeoParquetIngestionService} from '@ulpin/server/modules/usp/ingestion/geoparquet';
import {KMLController} from './kml.controller';
import {KMLIngestionService} from '@ulpin/server/modules/usp/ingestion/kml';
import {DXFController} from './dxf.controller';
import {DXFIngestionService} from '@ulpin/server/modules/usp/ingestion/dxf';

@Module({controllers:[IngestionController,LargeOriginalController,IngestionEventsController,ProjectedVectorController,PrivateMvtController,DocumentsController,DocumentClaimsController,DocumentProposalsController,SufficiencyController,AdaptiveMappingController,StreamingVectorController,ChunkMappingController,StreamedProfileController,RasterWindowController,PointBatchController,CityJSONController,IFCController,DXFController,KMLController,CityGMLController,GeoParquetController,GltfController,ObjController],providers:[ManualIngestionService,LargeOriginalService,ProjectedVectorService,PrivateMvtService,SemanticChunkService,DocumentIngestionService,DocumentClaimsService,DocumentProposalsService,IngestionSufficiencyService,AdaptiveMappingService,StreamingVectorService,ChunkMappingService,StreamedProfileService,StreamedMappingService,RasterWindowService,PointBatchService,CityJSONIngestionService,IFCIngestionService,DXFIngestionService,KMLIngestionService,CityGMLIngestionService,GeoParquetIngestionService,GltfIngestionService,ObjIngestionService]})
export class IngestionModule {}
