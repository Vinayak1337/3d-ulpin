import { Module } from '@nestjs/common';
import { FoundationModule } from './foundation/foundation.module';
import { domainModules } from './domain-modules';

@Module({ imports: [FoundationModule, ...domainModules] })
export class AppModule {}
