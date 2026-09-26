import { Controller, Get, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { query } from '@ulpin/server/infrastructure/db';
import { databaseReadiness } from '@ulpin/server/infrastructure/database-readiness';
import { checkStorage } from '@ulpin/server/infrastructure/storage';
import { settings } from '@ulpin/server/infrastructure/config';
import { workspaceCapabilities } from '@ulpin/server/infrastructure/workspace-capabilities';
import { assertLocalRequest } from '@ulpin/server/modules/usp/principal';
import { toWebRequest } from '../common/body';

@ApiTags('foundation')
@Controller('api')
export class FoundationController {
  @Get()
  @ApiOperation({ operationId: 'GET_api', summary: 'API entry point' })
  @ApiOkResponse({ schema: { type: 'object', required: ['service', 'version', 'api', 'health'], properties: {
    service: { type: 'string', example: '3d-ulpin' }, version: { type: 'string', example: 'v1' },
    api: { type: 'string', example: '/api/v1' }, health: { type: 'string', example: '/api/v1/health' },
  } } })
  root() {
    return { service: '3d-ulpin', version: 'v1', api: '/api/v1', health: '/api/v1/health' };
  }

  @Get('v1/workspace-capabilities')
  @ApiOperation({ operationId: 'GET_api_v1_workspace_capabilities', summary: 'Configured local workspace capability flags' })
  @ApiOkResponse({ schema: { type: 'object', required: ['runtime', 'provider', 'providerLocation', 'fullResidency', 'imageEgress'], properties: {
    runtime: { type: 'string', enum: ['loopback-configured', 'external-configured', 'unknown'] },
    provider: { type: 'string', enum: ['blocked', 'opted-in', 'unconfigured'] },
    providerLocation: { type: 'string', enum: ['unverified'] },
    fullResidency: { type: 'string', enum: ['unverified'] },
    imageEgress: { type: 'string', enum: ['blocked'] },
  } } })
  async capabilities(@Req() request: Request) {
    assertLocalRequest(await toWebRequest(request, 0));
    return workspaceCapabilities();
  }

  @Get('v1/health')
  @ApiOperation({ operationId: 'GET_api_v1_health', summary: 'Local dependency health' })
  @ApiOkResponse({ schema: { type: 'object', required: ['ok', 'services', 'dataMode'], properties: {
    ok: { type: 'boolean' }, dataMode: { type: 'string', enum: ['repository', 'linked'] },
    services: { type: 'object', required: ['database', 'storage', 'processor', 'redis', 'worker'], properties: {
      database: { type: 'boolean' }, storage: { type: 'boolean' }, processor: { type: 'boolean' },
      redis: { type: 'boolean' }, worker: { type: 'boolean' },
    } },
    databaseReadiness: { type: 'object', required: ['status','schema'], properties: {
      status: { type: 'string', enum: ['structurally_ready','schema_missing','unavailable'] },
      schema: { type: 'object', required: ['ready'], properties: {
        ready: { type: 'boolean' }, manifestSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
        targetToken: { type: 'string', nullable: true, description: 'Opaque API/database binding for reviewed loopback tooling.' },
        missingRelations: { type: 'array', items: {type:'string'} }, missingColumns: {type:'array',items:{type:'string'}},
        missingMigrations: {type:'array',items:{type:'string'}}, invalidIndexes: {type:'integer'},
        unvalidatedConstraints: {type:'array',items:{type:'object',properties:{name:{type:'string'},table:{type:'string'}}}},
      } },
      data: {type:'object',properties:{sourceCount:{type:'integer',nullable:true},importPackageCount:{type:'integer',nullable:true},
        physicalFeatureCount:{type:'integer',nullable:true},activeLegacyDatasetCount:{type:'integer',nullable:true}}},
      qualification: {type:'string'},
    } },
  } } })
  async health(@Req() request: Request) {
    assertLocalRequest(await toWebRequest(request, 0));
    const checks = await Promise.allSettled([
      query('SELECT PostGIS_Version()'),
      checkStorage(),
      Promise.resolve().then(async () => {
        const response = await fetch(`${settings.geoUrl}/internal/ready`, {
          headers: { Authorization: `Bearer ${settings.geoToken}` },
          signal: AbortSignal.timeout(3000),
        });
        if (!response.ok) throw new Error('Processor unavailable');
        return response.json() as Promise<{ ok: boolean; redis: boolean; worker: boolean }>;
      }),
      databaseReadiness(),
    ]);
    const readiness = checks[2].status === 'fulfilled' ? checks[2].value : null;
    const services = {
      database: checks[0].status === 'fulfilled',
      storage: checks[1].status === 'fulfilled',
      processor: !!readiness,
      redis: readiness?.redis === true,
      worker: readiness?.worker === true,
    };
    // Dependency liveness remains compatible; consumers must inspect schema admission separately.
    return { ok: Object.values(services).every(Boolean), services, dataMode: settings.dataMode,
      databaseReadiness: checks[3].status === 'fulfilled' ? checks[3].value : { status: 'unavailable', schema: { ready: false } } };
  }
}
