import { AppError } from '../../infrastructure/errors';
import { configuredGateway, hash, readProviderSecret, ModelGatewayConfigSchema } from './config';
import { ModelGateway } from './gateway';
import { PgModelCallLedger } from './ledger';
import { SarvamAdapter, ReplayAdapter } from './adapter';
import { TeacherRecordings } from './recordings';

// Replay never dispatches or debits the ledger. Funding/pricing fields are schema placeholders,
// not an approved allocation, tariff, processor qualification or permission to read a secret.
const REPLAY_GATEWAY_CONFIG = ModelGatewayConfigSchema.parse({
  projectId: 'mapping-replay', policyVersion: 'mapping-replay/1', fundingVersion: 'offline-no-funding',
  gatewayExclusiveFunding: true, indiaPrivateApproved: true, secretReference: 'ULPIN_PROVIDER_KEY_SARVAM',
  model: 'sarvam-105b', projectCapMicroInr: '1', principalDailyCallCap: 1,
  price: {
    version: 'offline-no-charge', inputPerMillionMicroInr: '1',
    cachedInputPerMillionMicroInr: '1', outputPerMillionMicroInr: '1',
  },
  inputBound: { version: 'offline-byte-bound/1', maxPromptTokens: 34816 },
  maxOutputTokens: 4096, timeoutMs: 45000, paceMs: 1500,
});

/** Lazy database import keeps manual/no-key checks independent of paid dispatch/storage. */
export async function modelGatewayRuntime(): Promise<ModelGateway | undefined> {
  const config = configuredGateway();
  if (!config) return undefined;
  const key = readProviderSecret(config.secretReference);
  if (!key) return undefined;
  const { transaction } = await import('../../infrastructure/db');
  return new ModelGateway(config,new PgModelCallLedger(transaction,config,hash(key),'sarvam'),new SarvamAdapter(key));
}
/** Mapping demo defaults to hash-pinned replay. Only explicit sarvam mode reads the one configured key. */
export async function mappingTeacherGatewayRuntime(
  mode = process.env.ULPIN_MAPPING_TEACHER_ADAPTER ?? 'replay',
): Promise<ModelGateway | undefined> {
  if (mode === 'sarvam') {
    const config = configuredGateway();
    if (config && !config.projectDailyCapMicroInr) {
      throw new AppError(503, 'MODEL_CONFIGURATION',
        'Mapping teacher live mode requires an approved daily money cap.');
    }
    return modelGatewayRuntime();
  }
  // Control is injectable only, never selected by environment.
  if (mode !== 'replay') return undefined;
  const recordings = new TeacherRecordings();
  const ledger = new PgModelCallLedger(async () => {
    throw new AppError(503, 'MODEL_REPLAY_UNAVAILABLE', 'Replay never dispatches or debits a paid ledger.');
  }, REPLAY_GATEWAY_CONFIG, hash('offline'), 'replay');
  return new ModelGateway(REPLAY_GATEWAY_CONFIG, ledger, new ReplayAdapter(key => recordings.replay(key, ['sarvam'])));
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
