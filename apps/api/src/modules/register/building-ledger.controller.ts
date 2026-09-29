import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { buildingLedger } from '@ulpin/server/modules/officer/building-ledger';
import { buildingLedgerDocumentation } from './building-ledger.documentation';

@ApiTags('officer')
@Controller('api/v1/buildings')
export class BuildingLedgerController {
  @Get(':buildingId/ledger')
  @ApiOperation({ operationId: 'GET_api_v1_buildings_buildingId_ledger',
    summary: 'Read the private recorded building ledger and explicit missing states' })
  @ApiResponse({ status: 200, schema: buildingLedgerDocumentation as never })
  async read(@Param('buildingId') buildingId: string) {
    return buildingLedger(z.uuid().parse(buildingId));
  }
}
