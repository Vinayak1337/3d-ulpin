import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from '@ulpin/server/infrastructure/errors';
import { redactDerivative } from '@ulpin/server/modules/usp/ingest/redact';
import { requestId } from './request-context';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    if (response.headersSent || response.destroyed) {
      response.destroy();
      return;
    }
    const id = requestId(request);
    let status = 503;
    let code = 'SERVICE_UNAVAILABLE';
    let message = 'A local service could not complete this operation. Check service health and retry.';
    let details: unknown;
    if (error instanceof ZodError) {
      status = 422; code = 'INVALID_INPUT';
      message = error.issues.map(issue => `${issue.path.join('.') || 'Input'}: ${issue.message}`).join('; ');
    } else if (error instanceof AppError) {
      status = error.status; code = error.code; message = redactDerivative(error.message);
      details = redactDerivative(error.details);
    } else if ((error as { code?: string })?.code === '23505') {
      status = 409; code = 'DUPLICATE_RECORD';
      message = 'This record already exists. Refresh before retrying.';
    } else if (error instanceof HttpException) {
      status = error.getStatus();
      code = status === 404 ? 'NOT_FOUND' : 'HTTP_ERROR';
      message = status === 404 ? 'This operation is not available.' : error.message;
    } else {
      console.error(`API request ${id} failed.`);
    }
    if (status === 413) response.setHeader('Connection', 'close');
    response.status(status).json({ error: { code, message, ...(details === undefined ? {} : { details }), requestId: id } });
  }
}
