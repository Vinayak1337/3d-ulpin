import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { AppError } from '@ulpin/server/infrastructure/errors';

/** Retains the spatial read boundary for browser subresource requests without Origin. */
@Injectable()
export class PrivateSpatialGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (request.header('sec-fetch-site') === 'cross-site')
      throw new AppError(403, 'CROSS_ORIGIN_READ', 'Cross-origin spatial reads are not allowed.');
    return true;
  }
}
