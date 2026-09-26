import { applyDecorators, ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiResponse } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { z, ZodError } from 'zod';
import { CoreContractError, parseUsp, USP_SCHEMA_VERSION, type UspScope } from '@ulpin/contracts/usp';
import { AppError } from '@ulpin/server/infrastructure/errors';
import { redactDerivative } from '@ulpin/server/modules/usp/ingest/redact';
import { readBoundedBytes } from '../../common/body';
import { requestId } from '../../common/request-context';
import { envelopeSchema, evidenceSchemas, openApiSchema, requestApiSchema } from './evidence.schemas';

export const USP_JSON_LIMIT = 1024 * 1024;

/** The legacy USP boundary has a 1 MiB received-byte limit, including chunked requests. */
export async function readUspBody<S extends z.ZodType>(request: Request, schema: S): Promise<z.output<S>> {
  let bytes: Buffer;
  try { bytes = await readBoundedBytes(request, USP_JSON_LIMIT); }
  catch (error) {
    if (error instanceof AppError && error.status === 413) {
      throw new AppError(413, 'USP_BODY_LIMIT', 'The request body is too large.');
    }
    throw error;
  }
  if (!bytes.length) throw new AppError(400, 'USP_BODY_REQUIRED', 'A JSON body is required.');
  let body: unknown;
  try { body = JSON.parse(bytes.toString('utf8')); }
  catch { throw new AppError(400, 'USP_INVALID_JSON', 'The request body must be valid JSON.'); }
  try { return parseUsp(schema, body); }
  catch (error) {
    if (error instanceof CoreContractError) {
      throw new AppError(400, 'USP_REQUEST_FAILED', 'This operation is unavailable. Check its input or service state.');
    }
    throw error;
  }
}

export function parseUspPath<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  try { return parseUsp(schema, value); }
  catch (error) {
    if (error instanceof CoreContractError) {
      throw new AppError(400, 'USP_REQUEST_FAILED', 'This operation is unavailable. Check its input or service state.');
    }
    throw error;
  }
}

export function uspEnvelope<T>(request: Request, scope: UspScope, data: T) {
  return { data, meta: { schemaVersion: USP_SCHEMA_VERSION, requestId: requestId(request), scope } };
}

/** Retains the USP wire error fields while redacting service messages. */
@Catch()
export class EvidenceExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    if (response.headersSent || response.destroyed) { response.destroy(); return; }
    const id = requestId(request);
    const status = error instanceof AppError ? error.status
      : error instanceof ZodError || error instanceof CoreContractError ? 400 : 503;
    const code = error instanceof AppError ? error.code : 'USP_REQUEST_FAILED';
    const message = error instanceof AppError ? redactDerivative(error.message)
      : 'This operation is unavailable. Check its input or service state.';
    if (status === 413) response.setHeader('Connection', 'close');
    response.status(status).json({ error: { code, message, retryable: status >= 500, requestId: id } });
  }
}

const errorSchema = openApiSchema(evidenceSchemas.error);
const errorResponses = [400, 403, 404, 409, 413, 422, 503].map(status =>
  ApiResponse({ status, description: status === 403
    ? 'USP denial or common loopback Host/Origin guard denial; no private source bytes or details'
    : 'USP error envelope; no private source bytes or details',
    schema: status === 403 ? openApiSchema(evidenceSchemas.forbiddenError) : errorSchema }));

export function UspJsonPost(operationId: string, summary: string, request: z.ZodType, response: z.ZodType) {
  return applyDecorators(
    ApiOperation({ operationId, summary }),
    ApiBody({ required: true, description: 'JSON, maximum 1 MiB of received bytes', schema: requestApiSchema(request) }),
    ApiResponse({ status: 200, description: 'Private exact-scope USP result', schema: envelopeSchema(response) }),
    ...errorResponses,
  );
}

export function UspBinaryPost(operationId: string, summary: string, request: z.ZodType) {
  return applyDecorators(
    ApiOperation({ operationId, summary }),
    ApiBody({ required: true, description: 'JSON, maximum 1 MiB of received bytes', schema: requestApiSchema(request) }),
    ApiResponse({ status: 200, description: 'Authorized original bytes; response Content-Type is the source media type',
      content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } },
      headers: { 'Cache-Control': { schema: { type: 'string', enum: ['no-store'] } },
        'Content-Disposition': { schema: { type: 'string', enum: ['attachment'] } },
        'X-Source-SHA256': { schema: { type: 'string', pattern: '^[a-f0-9]{64}$' } } } }),
    ...errorResponses,
  );
}

export function UspPacketGet(operationId: string, receipt: boolean) {
  return applyDecorators(
    ApiOperation({ operationId, summary: receipt ? 'Read authorized packet receipt' : 'Download authorized packet bytes' }),
    ApiParam({ name: 'packetId', schema: { type: 'string', format: 'uuid' } }),
    receipt
      ? ApiResponse({ status: 200, description: 'Private packet receipt',
        schema: envelopeSchema(evidenceSchemas.packetReceipt.response) })
      : ApiResponse({ status: 200, description: 'Exact private packet derivative; text or CSV',
        content: { 'text/plain': { schema: { type: 'string', format: 'binary' } },
          'text/csv': { schema: { type: 'string', format: 'binary' } } },
        headers: { 'Cache-Control': { schema: { type: 'string', enum: ['no-store'] } },
          'Content-Disposition': { schema: { type: 'string' } },
          'X-Artifact-SHA256': { schema: { type: 'string', pattern: '^[a-f0-9]{64}$' } } } }),
    ...errorResponses,
  );
}
