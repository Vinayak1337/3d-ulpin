import { z } from 'zod';
import { UspModelGatewayRequestSchema, UspModelGatewayResultSchema, UspRequestContextSchema,
  type RequestContext, type UspPorts } from '@ulpin/contracts/usp';
import { AppError } from '../../infrastructure/errors';
import { redactDerivative } from '../usp/ingest/redact';
import { hash, type GatewayConfig } from './config';
import { cost } from './pricing';
import { PgModelCallLedger } from './ledger';
import { minimizeMessages, ProviderFailure, type ProviderAdapter, type ProviderResult } from './adapter';

type Request = z.infer<typeof UspModelGatewayRequestSchema>;
type Result = z.infer<typeof UspModelGatewayResultSchema>;
export type TrustedCall = {
  invocationKey: string; attempt: number; consumer: 'INGEST' | 'ASSIST';
  scopeHash: string; sourceHashes: readonly string[]; deadlineAt: Date;
  taskKind: string; outputSchemaId: string; outputSchema: Record<string, unknown>;
  authorize: () => Promise<void>; minimizeOutput: (output: unknown) => unknown;
  replayKey?: string;
  observeResponse?: (event: {
    inputHash: string; latencyMs: number; result?: ProviderResult; failure?: ProviderFailure;
  }) => Promise<void>;
};

/** Uses the canonical USP gateway envelope. All routing/budget/profile controls are server-owned. */
export type ModelCallLedger = Pick<PgModelCallLedger,
  'admissionDelay' | 'reserve' | 'dispatch' | 'releaseBeforeDispatch' | 'retainExposure' | 'settle'>;
export class ModelGateway {
  constructor(readonly config: GatewayConfig, private readonly ledger: ModelCallLedger,
    private readonly adapter: ProviderAdapter) {}
  get adapterKind() {
    return this.adapter.kind;
  }
  /** Bind a server-authorized profile to the existing canonical port, never caller routing controls. */
  port(trusted: TrustedCall): Pick<UspPorts, 'modelGateway'> {
    return {modelGateway:async (ctx,request) => ({state:'available',data:await this.propose(ctx,request,trusted)})};
  }
  async propose(context: RequestContext, value: Request, trusted: TrustedCall): Promise<Result> {
    const ctx = UspRequestContextSchema.parse(context), request = UspModelGatewayRequestSchema.parse(value);
    if (ctx.principal.mode === 'public_interoperability')
      throw new AppError(403, 'MODEL_PRIVATE_ONLY', 'Private model inference is unavailable to the public surface.');
    if (request.policyVersion !== this.config.policyVersion || request.taskKind !== trusted.taskKind
      || request.outputSchemaId !== trusted.outputSchemaId)
      throw new AppError(422, 'MODEL_PROFILE', 'The configured model profile does not match this request.');
    await trusted.authorize();
    const input = z.strictObject({messages:z.unknown()}).parse(request.input);
    const messages = minimizeMessages(input.messages);
    const body = {messages,outputSchema:trusted.outputSchema,model:this.config.model,maxOutputTokens:this.config.maxOutputTokens};
    const bytes = Buffer.byteLength(JSON.stringify(body));
    if (bytes > Math.min(request.budget.maxInputBytes,32768) || bytes + 2048 > this.config.inputBound.maxPromptTokens)
      throw new AppError(413,'MODEL_INPUT_LIMIT','The final minimized request exceeds its approved input bound.');
    const sourceHashes = z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(64).parse(trusted.sourceHashes);
    const inputHash = hash({body,sourceHashes,scope:trusted.scopeHash,policy:this.config.policyVersion,
      outputSchemaId:request.outputSchemaId,taskKind:request.taskKind});
    if (this.adapter.kind === 'replay') {
      // Retained output is not another provider charge. No reservation, dispatch or new invoice.
      // The runtime installs no replay loader until actual eligible material is admitted.
      const signal=AbortSignal.timeout(Math.max(1,Math.min(this.config.timeoutMs,request.budget.deadlineMs,
        trusted.deadlineAt.getTime()-Date.now())));
      const replay=await Promise.race([
        this.adapter.propose({model:this.config.model,messages,outputSchema:trusted.outputSchema,
          maxOutputTokens: this.config.maxOutputTokens, inputHash, sourceHashes, signal,
          authorize: trusted.authorize, replayKey: trusted.replayKey,
        }),
        new Promise<never>((_,reject)=>signal.addEventListener('abort',()=>reject(new AppError(503,'MODEL_REPLAY_UNAVAILABLE',
          'Retained replay could not finish within its deadline.')),{once:true})),
      ]);
      await trusted.authorize();
      return UspModelGatewayResultSchema.parse({output:trusted.minimizeOutput(redactDerivative(replay.output)),
        modelId:this.config.model,outputSchemaId:request.outputSchemaId,evidenceRefs:request.evidenceRefs,replayed:true});
    }
    if (trusted.attempt === 2) {
      // Only model repair may wait within the original deadline; unknown transports never retry.
      const delay = await this.ledger.admissionDelay();
      if (delay > 0) {
        if (delay >= trusted.deadlineAt.getTime() - Date.now())
          throw new AppError(429,'MODEL_COOLDOWN','The shared cooldown exceeds the remaining extraction deadline.');
        await new Promise(resolve => setTimeout(resolve,delay));
        await trusted.authorize();
      }
    }
    const admission = await this.ledger.reserve({principalHash:hash(ctx.principal.subject),
      invocationKey:hash(trusted.invocationKey),attempt:trusted.attempt,consumer:trusted.consumer,
      inputHash,scopeHash:trusted.scopeHash,sourceHashes,deadlineAt:trusted.deadlineAt});
    const asResult = (output: unknown, receipt: NonNullable<typeof admission.call.receipt>) => UspModelGatewayResultSchema.parse({
      output:trusted.minimizeOutput(redactDerivative(output)),modelId:this.config.model,
      outputSchemaId:request.outputSchemaId,evidenceRefs:request.evidenceRefs,
      receipt:{callId:admission.call.id,...receipt,priceVersion:this.config.price.version},
    });
    if (!admission.admitted) {
      if (admission.call.state !== 'settled' || !admission.call.receipt)
        throw new AppError(503,'MODEL_CALL_PENDING','This call is already admitted or has unresolved exposure; no repeat dispatch occurs.');
      await trusted.authorize();
      return asResult(admission.call.output,admission.call.receipt);
    }
    // Mark intent durably before a single byte may leave. A crash after this point never refunds.
    try { await trusted.authorize(); await this.ledger.dispatch(admission.call.id); }
    catch (error) { await this.ledger.releaseBeforeDispatch(admission.call.id); throw error; }
    const duration = Math.min(this.config.timeoutMs,request.budget.deadlineMs,
      admission.call.deadline_at.getTime() - Date.now());
    const persistCompletion = async (result: ProviderResult) => {
      let actual: bigint;
      try {
        if (!result.usage || !/^[a-f0-9]{64}$/.test(result.responseHash)) throw new Error('Unverified receipt');
        actual = cost(result.usage,this.config.price);
      } catch {
        await this.ledger.retainExposure(admission.call.id);
        throw new AppError(503,'MODEL_USAGE_UNVERIFIED','Provider usage could not be verified. Its reservation remains held.');
      }
      const output = trusted.minimizeOutput(redactDerivative(result.output));
      const receipt = {httpStatus:result.httpStatus,responseHash:result.responseHash,
        inputTokens:result.usage!.promptTokens,outputTokens:result.usage!.completionTokens,
        actualMicroInr:actual.toString(),...(result.semanticError ? {semanticError:result.semanticError} : {})};
      return this.ledger.settle(admission.call.id,actual,output,receipt);
    };
    let result;
    const startedAt = Date.now();
    let observationFailed = false;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    try {
      result = await Promise.race([
        this.adapter.propose({model:this.config.model,messages,outputSchema:trusted.outputSchema,
          maxOutputTokens: this.config.maxOutputTokens, inputHash, sourceHashes, signal: controller.signal,
          authorize: trusted.authorize, replayKey: trusted.replayKey,
        }).then(async completion => {
            try {
              await trusted.observeResponse?.({ inputHash, latencyMs: Date.now() - startedAt, result: completion });
            } catch {
              observationFailed = true;
            }
            if (timedOut) {
              // A late known charge settles, but is never returned/published by the expired request.
              // Crash/DB failure still leaves the durable dispatched/unknown reservation intact.
              try { await persistCompletion(completion); } catch { /* exposure remains held */ }
            }
            return completion;
          }),
        new Promise<never>((_,reject) => {timer = setTimeout(() => {
          timedOut = true; controller.abort(); reject(new ProviderFailure('outcome_unknown'));
        }, Math.max(1,duration));}),
      ]);
    } catch (error) {
      // Never surface upstream bodies/credentials or retry an uncertain completion.
      const failure = error instanceof ProviderFailure ? error : new ProviderFailure('outcome_unknown');
      try {
        await trusted.observeResponse?.({ inputHash, latencyMs: Date.now() - startedAt, failure });
      } catch {
        // No output will be accepted after a transport failure.
      }
      await this.ledger.retainExposure(admission.call.id,failure);
      throw new AppError(failure.kind === 'rate_limited' ? 429 : 503,`MODEL_${failure.kind.toUpperCase()}`,
        'The provider call is unavailable. Its exposure remains reserved; manual preparation remains available.');
    } finally { if (timer) clearTimeout(timer); }
    // Settlement is independent of job/revision/access acceptance, including malformed results.
    const settled = await persistCompletion(result);
    if (observationFailed) {
      throw new AppError(503, 'MODEL_RECORDING_UNAVAILABLE',
        'The response was charged but could not be recorded. Continue manually.');
    }
    await trusted.authorize();
    return asResult(settled.output,settled.receipt!);
  }
}
