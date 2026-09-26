import { Module } from '@nestjs/common';
import { RegisterController } from './register.controller';
import { OfficerController } from './officer.controller';
import { RegisterService } from './register.service';
import { OfficerService } from './officer.service';

@Module({
  controllers: [RegisterController, OfficerController],
  providers: [RegisterService, OfficerService],
})
export class RegisterModule {}
