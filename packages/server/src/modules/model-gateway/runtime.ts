import { AppError } from '../../infrastructure/errors';
import { configuredGateway, hash, readProviderSecret } from './config';
import { ModelGateway } from './gateway';
import { PgModelCallLedger } from './ledger';
import { SarvamAdapter } from './adapter';

/** Lazy database import keeps manual/no-key checks independent of paid dispatch/storage. */
export async function modelGatewayRuntime(): Promise<ModelGateway | undefined> {
  const config = configuredGateway();
  if (!config) return undefined;
  const key = readProviderSecret(config.secretReference);
  if (!key) return undefined;
  const { transaction } = await import('../../infrastructure/db');
  return new ModelGateway(config,new PgModelCallLedger(transaction,config,hash(key),'sarvam'),new SarvamAdapter(key));
}
export function modelGatewayPolicyHash(): string | undefined {
  const config = configuredGateway();
  return config ? hash(config) : undefined;
}
export async function migrateModelGateway() {
  const { query } = await import('../../infrastructure/db');
  const { sql } = await import('../../infrastructure/sql-loader');
  await query(sql('model-gateway.schema'));
}
export function assertCurrentGatewayPolicy(policyHash: string | undefined): void {
  if (!policyHash || policyHash !== modelGatewayPolicyHash())
    throw new AppError(403,'MODEL_POLICY_CHANGED','The extraction policy changed; stored model output cannot be reused or applied.');
}
