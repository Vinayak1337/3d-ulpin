import { AppError } from '../../infrastructure/errors';
import { configuredGateway, hash, providerKeyReferences, readProviderSecret, ModelGatewayConfigSchema,
  type GatewayConfig } from './config';
import { ModelGateway } from './gateway';
import { PgModelCallLedger } from './ledger';
import { SarvamAdapter, SarvamKeyListAdapter, ReplayAdapter } from './adapter';
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

/** Every key the policy names, in the owner's order. One absent key means no gateway, as with one key. */
function readProviderKeys(config: GatewayConfig): string[] | undefined {
  const keys = providerKeyReferences(config).map(reference => readProviderSecret(reference));
  return keys.every(key => key !== undefined) ? keys : undefined;
}
/** The paid ledger of the configured policy: one key's hash, or the key hashes of a list in order. */
async function configuredLedger(config: GatewayConfig, keys: readonly string[]): Promise<PgModelCallLedger> {
  const { transaction } = await import('../../infrastructure/db');
  const hashes = keys.map(key => hash(key));
  return new PgModelCallLedger(transaction, config, config.secretReferences ? hashes : hashes[0], 'sarvam');
}
/** Lazy database import keeps manual/no-key checks independent of paid dispatch/storage. */
export async function modelGatewayRuntime(): Promise<ModelGateway | undefined> {
  const config = configuredGateway();
  const keys = config && readProviderKeys(config);
  if (!config || !keys) return undefined;
  const adapter = config.secretReferences ? new SarvamKeyListAdapter(keys) : new SarvamAdapter(keys[0]);
  return new ModelGateway(config, await configuredLedger(config, keys), adapter);
}
/** For the owner's script: the ledger of the enabled policy, or a refusal that names no key. */
export async function ownerKeyLedger(): Promise<PgModelCallLedger> {
  const config = configuredGateway();
  const keys = config && readProviderKeys(config);
  if (!config || !keys) {
    throw new AppError(503, 'MODEL_CONFIGURATION', 'The gateway is not enabled with every key its policy names.');
  }
  return configuredLedger(config, keys);
}
/** Mapping demo defaults to hash-pinned replay. Only explicit sarvam mode reads the configured key or keys. */
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
