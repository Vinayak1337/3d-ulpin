import type { GatewayConfig } from './config';
import { AppError } from '../../infrastructure/errors';

export type Usage = { promptTokens: number; completionTokens: number; cachedPromptTokens?: number };
const token = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
const ceil = (a: bigint, b: bigint) => (a + b - 1n) / b;
export function checkedAmount(value: bigint): bigint {
  if (value < 0n || value > 9223372036854775807n)
    throw new AppError(422, 'MODEL_AMOUNT_RANGE', 'Model cost exceeds the supported amount range.');
  return value;
}
/** Reasoning is already included in completionTokens. Never add it twice. */
export function cost(usage: Usage, price: GatewayConfig['price']): bigint {
  if (!token(usage.promptTokens) || !token(usage.completionTokens)
    || (usage.cachedPromptTokens !== undefined && !token(usage.cachedPromptTokens))
    || (usage.cachedPromptTokens ?? 0) > usage.promptTokens)
    throw new AppError(503, 'MODEL_USAGE_UNVERIFIED', 'Provider usage is missing or invalid; its reservation remains held.');
  const cached = BigInt(usage.cachedPromptTokens ?? 0);
  return checkedAmount(ceil((BigInt(usage.promptTokens) - cached) * BigInt(price.inputPerMillionMicroInr)
    + cached * BigInt(price.cachedInputPerMillionMicroInr)
    + BigInt(usage.completionTokens) * BigInt(price.outputPerMillionMicroInr), 1000000n));
}
export function reservation(config: GatewayConfig): bigint {
  return checkedAmount(ceil(cost({promptTokens:config.inputBound.maxPromptTokens,
    completionTokens:config.maxOutputTokens}, config.price) * BigInt(10000 + config.cushionBps), 10000n));
}
