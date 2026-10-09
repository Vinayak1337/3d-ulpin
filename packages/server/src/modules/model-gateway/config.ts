import { createHash } from 'node:crypto';
import { constants, openSync, fstatSync, readFileSync, closeSync } from 'node:fs';
import { z } from 'zod';
import { AppError } from '../../infrastructure/errors';

const amount = z.string().regex(/^(0|[1-9][0-9]{0,17})$/).refine(v => BigInt(v) <= 9223372036854775807n);
const version = z.string().regex(/^[a-zA-Z0-9_.:/-]{1,160}$/);
export function validateSecretReference(reference: string): string {
  const normalized = reference.startsWith('env:') ? reference.slice(4) : reference;
  if (!/^(ULPIN_PROVIDER_KEY_[A-Z][A-Z0-9_]{0,63}|\/run\/secrets\/ULPIN_PROVIDER_KEY_[A-Z][A-Z0-9_]{0,63})$/.test(normalized)) {
    throw new AppError(422, 'MODEL_SECRET_REFERENCE', 'Provider secrets must use the server-only ULPIN_PROVIDER_KEY namespace.');
  }
  return normalized;
}

/** Nonsecret, explicitly approved/versioned inputs. No production tariff or funding defaults. */
export const ModelGatewayConfigSchema = z.strictObject({
  projectId: version, policyVersion: version, fundingVersion: version,
  gatewayExclusiveFunding: z.literal(true), indiaPrivateApproved: z.literal(true),
  secretReference: z.string().transform(validateSecretReference),
  model: z.literal('sarvam-105b'),
  projectCapMicroInr: amount.refine(v => BigInt(v) > 0n),
  ingestProtectedBps: z.number().int().min(7000).max(10000).default(7000),
  principalDailyCallCap: z.number().int().min(1).max(10000),
  projectDailyCapMicroInr: amount.refine(v => BigInt(v) > 0n).optional(),
  price: z.strictObject({ version, inputPerMillionMicroInr: amount,
    cachedInputPerMillionMicroInr: amount, outputPerMillionMicroInr: amount }),
  cushionBps: z.number().int().min(0).max(10000).default(2000),
  // This is an operator-qualified bound, not a guessed tokenizer ratio.
  inputBound: z.strictObject({version, maxPromptTokens: z.number().int().min(34816).max(131072)}),
  maxOutputTokens: z.number().int().min(1).max(4096).default(2048),
  timeoutMs: z.number().int().min(1000).max(45000).default(45000),
  paceMs: z.number().int().min(1500).max(60000),
}).superRefine((c, ctx) => {
  if (BigInt(c.price.cachedInputPerMillionMicroInr) > BigInt(c.price.inputPerMillionMicroInr))
    ctx.addIssue({ code:'custom', message:'Cached price exceeds uncached price.' });
  if (BigInt(c.price.inputPerMillionMicroInr) === 0n || BigInt(c.price.outputPerMillionMicroInr) === 0n)
    ctx.addIssue({ code:'custom', message:'Paid transport requires nonzero approved prices.' });
});
export type GatewayConfig = z.infer<typeof ModelGatewayConfigSchema>;
export const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function configuredGateway(env: NodeJS.ProcessEnv = process.env): GatewayConfig | undefined {
  if (env.ULPIN_MODEL_GATEWAY_ENABLED !== '1') return undefined;
  try { return ModelGatewayConfigSchema.parse(JSON.parse(env.ULPIN_MODEL_GATEWAY_CONFIG ?? '')); }
  catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(422, 'MODEL_CONFIGURATION', 'The model gateway needs approved funding, prices, input bounds and India-private policy configuration.');
  }
}

/** Validate before any environment/file read; no symlinks or arbitrary paths. */
export function readProviderSecret(reference: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const name = validateSecretReference(reference);
  let key: string | undefined;
  if (name.startsWith('/run/secrets/')) {
    let fd: number | undefined;
    try {
      fd = openSync(name, constants.O_RDONLY | constants.O_NOFOLLOW);
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.size > 8192) throw new Error('Invalid secret file');
      key = readFileSync(fd, 'utf8').trim();
    } catch { throw new AppError(503, 'MODEL_SECRET_UNAVAILABLE', 'The configured provider secret is unavailable.'); }
    finally { if (fd !== undefined) closeSync(fd); }
  } else key = env[name];
  if (!key) return undefined;
  if (key.length > 8192 || /[\s\x00-\x1f\x7f]/.test(key))
    throw new AppError(503, 'MODEL_SECRET_UNAVAILABLE', 'The configured provider secret is invalid.');
  return key;
}
