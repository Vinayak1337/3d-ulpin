import { Module } from '@nestjs/common';
import { FoundationController } from './foundation.controller';

@Module({ controllers: [FoundationController] })
export class FoundationModule {}
