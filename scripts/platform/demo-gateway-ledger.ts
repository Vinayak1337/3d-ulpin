// Owner steps on the gateway ledger, run by demo-gateway.mjs with the demo settings and the database up:
//   key-marks | reconcile <reason> | restore-key <NAME> <reason>
// Prints key names, states and times only; never a key value, a part of one or a hash.
import { ownerKeyLedger } from '@ulpin/server/modules/model-gateway/runtime';
import { AppError } from '@ulpin/server/infrastructure/errors';

async function ledgerStep([action, first = '', second = '']: string[]): Promise<string[]> {
  const ledger = await ownerKeyLedger();
  if (action === 'key-marks') {
    return (await ledger.keyStates()).map(key =>
      [key.reference, key.state, key.reason, key.markedAt].filter(Boolean).join(' '));
  }
  if (action === 'reconcile') return [`key list: ${await ledger.reconcileKeys(first)}`];
  if (action === 'restore-key') {
    return [`${first}: ${await ledger.restoreKey(first, second) ? 'restored' : 'was not marked used up'}`];
  }
  throw new AppError(422, 'MODEL_CONFIGURATION', 'Unknown ledger step.');
}

/** A leading --runtime <name> (default ulpin-demo) must be the runtime whose settings this child was given. */
function stepOfRuntime(args: string[]): string[] {
  const named = args[0] === '--runtime';
  if ((named ? args[1] : 'ulpin-demo') !== process.env.COMPOSE_PROJECT_NAME) {
    throw new AppError(422, 'MODEL_CONFIGURATION', 'The ledger step was given another runtime\'s settings.');
  }
  return named ? args.slice(2) : args;
}

try {
  (await ledgerStep(stepOfRuntime(process.argv.slice(2)))).forEach(line => console.log(line));
} catch (error) {
  // Only the gateway's own closed messages leave; a driver or parser error could carry a configured value.
  console.error(error instanceof AppError ? `${error.code}: ${error.message}` : 'The ledger step failed.');
  process.exitCode = 1;
} finally {
  const { closePool } = await import('@ulpin/server/infrastructure/db');
  await closePool();
}
