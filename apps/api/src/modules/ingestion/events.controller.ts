import { Controller, Get, Param, Req, Res, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { CASE_INGESTION_VERSION, CaseIngestionControlSchema, CaseIngestionEventSchema, type CaseIngestionControl } from '@ulpin/contracts/usp';
import { AppError } from '@ulpin/server/infrastructure/errors';
import {
  CaseIngestionReader, INGESTION_EVENT_LIMITS as limits, IngestionResync, assertIngestionBinding,
  ingestionCursor, parseIngestionCursor, reserveIngestionReader,
} from '@ulpin/server/modules/usp/ingestion/events';
import { apiPort, assertLocalHttpRequest } from '../../common/request-context';
import { PrivateSpatialGuard } from '../spatial/private-spatial.guard';
import { writeIngestionFrame, waitIngestionPoll } from './events.transport';

type SwaggerSchema = Extract<Parameters<typeof ApiResponse>[0], {schema: unknown}>['schema'];
const failure = z.toJSONSchema(z.object({error: z.object({code: z.string(), message: z.string(), requestId: z.string().uuid(), details: z.unknown().optional()})}), {target: 'openapi-3.0'}) as unknown as SwaggerSchema;
function cursorInputs(request: Request) {
  const query = new URL(request.originalUrl, 'http://localhost').searchParams;
  if ([...query.keys()].some(key => key !== 'cursor') || query.getAll('cursor').length > 1)
    throw new AppError(422, 'INGESTION_QUERY', 'Only one optional first cursor is accepted.');
  const names = request.rawHeaders.filter((_, index) => index % 2 === 0);
  if (names.filter(name => name.toLowerCase() === 'last-event-id').length > 1)
    throw new AppError(422, 'INGESTION_CURSOR', 'Use one Last-Event-ID header.');
  const header = request.headers['last-event-id'];
  if (Array.isArray(header)) throw new AppError(422, 'INGESTION_CURSOR', 'Use one Last-Event-ID header.');
  return {query: query.get('cursor') ?? undefined, header};
}

@ApiTags('private ingestion events')
@UseGuards(PrivateSpatialGuard)
@Controller('api/v1/ingestion')
export class IngestionEventsController {
  @Get('cases/:caseId/events')
  @ApiOperation({operationId:'GET_api_v1_ingestion_cases_caseId_events',summary:'Read committed private case ingestion notifications with bounded durable replay'})
  @ApiParam({name:'caseId',schema:{type:'string',format:'uuid'}})
  @ApiQuery({name:'cursor',required:false,schema:{type:'string',pattern:'^(0|[1-9][0-9]*)$',maxLength:97},description:'Omit to tail the current head; 0 replays retained events. Last-Event-ID takes precedence on reconnect if it names this case/access context and is at or beyond the first query cursor; a backwards cursor conflicts.'})
  @ApiHeader({name:'Last-Event-ID',required:false,description:'Case/access-bound decimal SSE ID. A copied cursor from another case or access context is rejected.'})
  @ApiResponse({status:200,description:'SSE ready, ingestion.change and resync frames. Every notification requires refreshing current records. Heartbeats are comments without IDs. Single configured local operator only.',content:{'text/event-stream':{schema:{type:'string'},
    'x-change-data-schema':z.toJSONSchema(CaseIngestionEventSchema,{target:'openapi-3.0'}),
    'x-control-data-schema':z.toJSONSchema(CaseIngestionControlSchema,{target:'openapi-3.0'})} as any}})
  @ApiResponse({status:403,schema:failure}) @ApiResponse({status:404,schema:failure})
  @ApiResponse({status:409,schema:failure}) @ApiResponse({status:422,schema:failure})
  @ApiResponse({status:429,schema:failure}) @ApiResponse({status:503,schema:failure})
  async events(@Param('caseId') caseId: string, @Req() request: Request, @Res() response: Response) {
    const reader = new CaseIngestionReader(caseId), inputs = cursorInputs(request);
    let cursor = parseIngestionCursor(reader.binding, inputs.query, inputs.header);
    const release = reserveIngestionReader(reader.binding), abort = new AbortController();
    const closed = () => abort.abort();
    request.once('aborted', closed); response.once('close', closed);
    const duration = setTimeout(closed, limits.durationMs);
    const assertAccess = () => {
      abort.signal.throwIfAborted();
      assertLocalHttpRequest(request, apiPort());
      if (request.header('sec-fetch-site') === 'cross-site') throw new AppError(403, 'CROSS_ORIGIN_READ', 'Cross-origin reads are not allowed.');
      assertIngestionBinding(reader.binding);
    };
    try {
      assertAccess();
      let page = await reader.read(cursor, abort.signal);
      cursor ??= page.head;
      assertAccess();
      response.status(200).set({
        'Content-Type':'text/event-stream; charset=utf-8', 'Cache-Control':'private, no-store',
        Connection:'keep-alive', 'X-Accel-Buffering':'no', 'X-Content-Type-Options':'nosniff',
      });
      response.flushHeaders();
      const control = async (kind: 'ready' | 'resync', reason: CaseIngestionControl['reason']) => {
        const body = CaseIngestionControlSchema.parse({version:CASE_INGESTION_VERSION,caseId:reader.binding.caseId,kind,reason,
          cursor:ingestionCursor(reader.binding,cursor!),headCursor:ingestionCursor(reader.binding,page.head),caseRevision:page.caseRevision,requiresRefresh:true});
        // Resync never advances Last-Event-ID past records the consumer has refreshed.
        await writeIngestionFrame(response,`${kind==='ready'?`id: ${body.cursor}\n`:''}event: ${kind}\ndata: ${JSON.stringify(body)}\n\n`,abort.signal,assertAccess);
      };
      await control('ready','connected');
      const context = page.context;
      let delivered = 0, heartbeat = Date.now();
      while (!abort.signal.aborted) {
        for (const event of page.events) {
          if (++delivered > limits.replay) { await control('resync','replay_limit'); return; }
          await writeIngestionFrame(response,`id: ${ingestionCursor(reader.binding,BigInt(event.sequence))}\nevent: ingestion.change\ndata: ${JSON.stringify(event)}\n\n`,abort.signal,assertAccess);
          cursor = BigInt(event.sequence);
        }
        if (page.context !== context) { await control('resync','context_changed'); return; }
        if (cursor === page.head) {
          if (Date.now()-heartbeat >= limits.heartbeatMs) {
            await writeIngestionFrame(response,': heartbeat\n\n',abort.signal,assertAccess); heartbeat = Date.now();
          }
          await waitIngestionPoll(abort.signal);
        }
        try { page = await reader.read(cursor,abort.signal); }
        catch (error) {
          if (!(error instanceof IngestionResync)) throw error;
          page = {...page,head:error.page.head,caseRevision:error.page.caseRevision};
          await control('resync',error.reason); return;
        }
      }
    } catch (error) {
      if (!response.headersSent && !abort.signal.aborted) throw error;
      // After headers, failed access/DB reads close the private stream; no JSON or error text is injected.
      response.destroy();
    } finally {
      abort.abort(); clearTimeout(duration);
      request.removeListener('aborted',closed); response.removeListener('close',closed);
      release();
      if (response.headersSent && !response.destroyed) response.end();
    }
  }
}
