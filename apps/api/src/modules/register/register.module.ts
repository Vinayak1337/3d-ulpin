import { Module } from '@nestjs/common';
import { RegisterController } from './register.controller';
import { OfficerController } from './officer.controller';
import { RegisterService } from './register.service';
import { OfficerService } from './officer.service';
import { BuildingLedgerController } from './building-ledger.controller';

@Module({
  controllers: [RegisterController, OfficerController, BuildingLedgerController],
  providers: [RegisterService, OfficerService],
})
export class RegisterModule {}
