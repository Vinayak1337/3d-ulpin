import { z } from 'zod';
import { AppError } from '../../infrastructure/errors';
import { redactDerivative } from '../usp/ingest/redact';
import { hash } from './config';
import { createHash } from 'node:crypto';
import type { Usage } from './pricing';
import { minimizeDecodedOutput, minimizeStructuredText } from './redaction';

export type Message = { role: 'system' | 'user' | 'assistant'; content: string };
export type ProviderRequest = {
  model: 'sarvam-105b'; messages: Message[]; outputSchema: Record<string, unknown>;
  maxOutputTokens: number; inputHash: string; sourceHashes: readonly string[];
  signal: AbortSignal; authorize: () => Promise<void>;
};
export type ProviderResult = { output: unknown; responseHash: string; usage?: Usage;
  httpStatus: number; semanticError?: 'invalid_output' | 'truncated_output'; };
export type FailureKind = 'quota_exhausted' | 'rate_limited' | 'credential_invalid' | 'capability_denied'
  | 'input_rejected' | 'outcome_unknown';
export class ProviderFailure extends Error {
  constructor(readonly kind: FailureKind, readonly httpStatus?: number, readonly cooldownMs = 0) {
    super('The provider call could not be accepted; manual preparation remains available.');
  }
}
export interface ProviderAdapter {
  readonly kind: 'sarvam' | 'control' | 'replay';
  propose(request: ProviderRequest): Promise<ProviderResult>;
}

/** The same minimizer runs for live, injected controls, retry and replay. */
export function minimizeMessages(value: unknown): Message[] {
  const parsed = z.array(z.strictObject({role:z.enum(['system','user','assistant']),
    content:z.string().max(32768)})).min(1).max(4).safeParse(value);
  if (!parsed.success || parsed.data.some(m => /data:|image_url|base64/i.test(m.content)))
    throw new AppError(403, 'MODEL_PROMPT_PRIVACY', 'Only bounded minimized text messages may reach the provider.');
  const messages = parsed.data.map(m => ({role:m.role,content:minimizeStructuredText(m.content)}));
  if (Buffer.byteLength(JSON.stringify(messages)) > 24 * 1024)
    throw new AppError(413, 'MODEL_INPUT_LIMIT', 'Select smaller source excerpts for extraction.');
  return messages;
}

export function classifyProviderFailure(status: number, code: unknown, retryAfter: string | null, now = Date.now()): ProviderFailure {
  const cooldown = () => {
    const delay = retryAfter && /^\d+(?:\.\d+)?$/.test(retryAfter)
      ? Number(retryAfter) * 1000 : retryAfter ? Date.parse(retryAfter) - now : 5000;
    // A long server cooldown is preserved (bounded to a day); this gateway never sleeps/retries through it.
    return Math.min(86400000, Math.max(1000, Number.isFinite(delay) ? delay : 5000));
  };
  if (status === 402 || code === 'insufficient_quota_error') return new ProviderFailure('quota_exhausted', status);
  if (status === 429) return new ProviderFailure('rate_limited', status, cooldown());
  if (status === 403 && code === 'invalid_api_key_error') return new ProviderFailure('credential_invalid', status);
  if (status === 401 || status === 403) return new ProviderFailure('capability_denied', status);
  if ([400,413,422].includes(status)) return new ProviderFailure('input_rejected', status);
  return new ProviderFailure('outcome_unknown', status, status >= 500 ? 5000 : 0);
}

const usageSchema = z.object({prompt_tokens:z.number().int().nonnegative().safe(),
  completion_tokens:z.number().int().nonnegative().safe(),
  prompt_tokens_details:z.object({cached_tokens:z.number().int().nonnegative().safe().optional()}).optional()});
export async function boundedProviderJson(response: Response): Promise<{body:unknown;responseHash:string}> {
  const reader = response.body?.getReader();
  if (!reader) throw new ProviderFailure('outcome_unknown', response.status);
  const chunks: Uint8Array[] = []; let total = 0;
  try {
    for (;;) {
      const {done,value} = await reader.read(); if (done) break;
      total += value.length;
      if (total > 1024 * 1024) throw new ProviderFailure('outcome_unknown', response.status);
      chunks.push(value);
    }
    const bytes = Buffer.concat(chunks);
    return {body:JSON.parse(bytes.toString('utf8')),responseHash:createHash('sha256').update(bytes).digest('hex')};
  } catch { throw new ProviderFailure('outcome_unknown', response.status); }
  finally { await reader.cancel().catch(() => {}); }
}

/** Protocol reference: https://docs.sarvam.ai/api-reference/chat/chat-completions-v1.
 * Fixed destination, redirect-deny, no SDK retries/tools, nonstreamed low-reasoning n=1.
 * Configuration does not establish hosting residency or processor permission qualification.
 */
export class SarvamAdapter implements ProviderAdapter {
  readonly kind = 'sarvam' as const;
  constructor(private readonly key: string, private readonly fetcher: typeof fetch = fetch) {}
  async propose(request: ProviderRequest): Promise<ProviderResult> {
    const messages = minimizeMessages(request.messages).map(m => ({...m,content:minimizeStructuredText(m.content,this.key)}));
    await request.authorize();
    let response: Response;
    try {
      response = await this.fetcher('https://api.sarvam.ai/v1/chat/completions', {
        method:'POST', headers:{'api-subscription-key':this.key,'Content-Type':'application/json'},
        redirect:'error', cache:'no-store', signal:request.signal,
        body:JSON.stringify({model:request.model,messages,max_tokens:request.maxOutputTokens,
          temperature:0.2,reasoning_effort:'low',n:1,stream:false,
          response_format:{type:'json_schema',json_schema:{name:'officer_grounded_facts',strict:true,schema:request.outputSchema}}}),
      });
    } catch { throw new ProviderFailure('outcome_unknown'); }
    const parsedResponse = await boundedProviderJson(response);
    const upstream: any = parsedResponse.body;
    if (!response.ok) throw classifyProviderFailure(response.status, upstream?.error?.code ?? upstream?.error?.type, response.headers.get('retry-after'));
    const parsed = usageSchema.safeParse(upstream?.usage);
    const usage = parsed.success ? {promptTokens:parsed.data.prompt_tokens,completionTokens:parsed.data.completion_tokens,
      ...(parsed.data.prompt_tokens_details?.cached_tokens === undefined ? {} : {cachedPromptTokens:parsed.data.prompt_tokens_details.cached_tokens})} : undefined;
    const choice = upstream?.choices?.length === 1 ? upstream.choices[0] : undefined;
    let output: unknown; let semanticError: ProviderResult['semanticError'];
    if (choice?.finish_reason !== 'stop' || choice?.message?.tool_calls?.length
      || typeof choice?.message?.content !== 'string' || !choice.message.content.trim())
      semanticError = choice?.finish_reason === 'length' ? 'truncated_output' : 'invalid_output';
    else { try { output = minimizeDecodedOutput(JSON.parse(choice.message.content),this.key); } catch { semanticError = 'invalid_output'; } }
    return {output:output ?? {invalidResponse:true},responseHash:parsedResponse.responseHash,httpStatus:response.status,usage,semanticError};
  }
}

/** Control-only injection. No environment/HTTP selector can install this adapter. */
export class ControlAdapter implements ProviderAdapter {
  readonly kind = 'control' as const;
  constructor(private readonly control: (request: ProviderRequest) => Promise<ProviderResult>) {}
  propose(request: ProviderRequest) { return this.control({...request,messages:minimizeMessages(request.messages)}); }
}

export type RetainedReplay = {
  inputHash: string; sourceHashes: readonly string[]; responseHash: string; response: ProviderResult;
  eligible: boolean;
};
/** No supplied replay corpus. A caller must load actual retained eligible, authorized material. */
export class ReplayAdapter implements ProviderAdapter {
  readonly kind = 'replay' as const;
  constructor(private readonly retained: (inputHash: string) => Promise<RetainedReplay | undefined>) {}
  async propose(request: ProviderRequest): Promise<ProviderResult> {
    minimizeMessages(request.messages);
    await request.authorize();
    const receipt = await this.retained(request.inputHash);
    if (!receipt?.eligible || receipt.inputHash !== request.inputHash
      || hash([...receipt.sourceHashes].sort()) !== hash([...request.sourceHashes].sort())
      || receipt.responseHash !== hash(receipt.response) || receipt.response.semanticError
      || !/^[a-f0-9]{64}$/.test(receipt.response.responseHash))
      throw new AppError(503, 'MODEL_REPLAY_UNAVAILABLE', 'No eligible hash-pinned retained replay is available for these inputs.');
    await request.authorize();
    return {...receipt.response, output:redactDerivative(receipt.response.output)};
  }
}
