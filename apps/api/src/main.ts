import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Request, Response, NextFunction } from 'express';
import { closePool } from '@ulpin/server/infrastructure/db';
import { closeStorageClient } from '@ulpin/server/infrastructure/storage';
import { setRuntimeLoopbackPort } from '@ulpin/server/infrastructure/loopback-host';
import { AppModule } from './app.module';
import { ApiExceptionFilter } from './common/api-exception.filter';
import { apiAllowedOrigins, apiPort, guardLocalRequest } from './common/request-context';
import { setupApiDocs } from './openapi';
import { localOperatorSubject } from '@ulpin/server/modules/usp/principal';

export async function bootstrap(): Promise<NestExpressApplication> {
  localOperatorSubject();
  const port = apiPort();
  const allowedOrigins = apiAllowedOrigins();
  setRuntimeLoopbackPort(port);
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
    abortOnError: false,
  });
  // Host and Origin checks use the socket request. Forwarded headers never alter them.
  app.getHttpAdapter().getInstance().set('trust proxy', false);
  app.getHttpAdapter().getInstance().disable('x-powered-by');
  app.use((request: Request, response: Response, next: NextFunction) =>
    guardLocalRequest(request, response, next, port, allowedOrigins));
  app.useGlobalFilters(new ApiExceptionFilter());
  setupApiDocs(app);
  await app.listen(port, '127.0.0.1');
  return app;
}

if (process.env.NODE_ENV !== 'test') {
  bootstrap().then(app => {
    let stopping = false;
    const stop = async () => {
      if (stopping) return;
      stopping = true;
      try {
        await app.close();
      } catch (error) {
        console.error('API listener shutdown failed.', error);
        process.exitCode = 1;
      }
      try {
        await closePool();
      } catch (error) {
        console.error('API database shutdown failed.', error);
        process.exitCode = 1;
      }
      closeStorageClient();
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  }).catch(error => {
    console.error('API startup failed.', error);
    process.exitCode = 1;
  });
}
