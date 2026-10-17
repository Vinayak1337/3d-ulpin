import { Injectable } from '@nestjs/common';
import { canonicalArea } from '@ulpin/server/modules/areas/canonical-area';
import { canonicalBuilding } from '@ulpin/server/modules/registry/canonical-building';

@Injectable()
export class CanonicalProjectionService {
  area = canonicalArea;
  building = canonicalBuilding;
}
