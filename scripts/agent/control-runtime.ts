// Software-control support ONLY. No environment/runtime selector can install this fake ledger.
// All production Sarvam admission/settlement uses the existing PgModelCallLedger.
import { randomUUID } from 'node:crypto';
import type { RequestContext } from '../../packages/contracts/src/usp/index';
import { ModelGateway, type ModelCallLedger } from '../../packages/server/src/modules/model-gateway/gateway';
import { ModelGatewayConfigSchema, hash } from '../../packages/server/src/modules/model-gateway/config';
import type {
  ProviderRequest,
  ProviderResult,
} from '../../packages/server/src/modules/model-gateway/adapter';
import type { Admission, Call, CallReceipt } from '../../packages/server/src/modules/model-gateway/ledger';
import { reservation } from '../../packages/server/src/modules/model-gateway/pricing';
import { AppError } from '../../packages/server/src/infrastructure/errors';

export const goodFile = 'fixtures/usp/D4/reference-area-gurugram-59-63a/lgd-gurugram.csv';
export const difficultFile = 'E:/BhuAayam-data/task-data/ulpin-data-09/gmda-sectors-59-63a.json';
export const requestContext: RequestContext = {
  requestId: 'a2-control',
  principal: {
    subject: 'local-os:a2-control',
    roles: ['operator'],
    entitlementVersion: 'local-1',
    mode: 'local_demo',
  },
  accessViewId: 'a2-control',
  policyVersion: 'usp-local-1',
};
export const controlConfig = () =>
  ModelGatewayConfigSchema.parse({
    projectId: 'a2-control',
    policyVersion: 'a2-control/1',
    fundingVersion: 'control-only',
    gatewayExclusiveFunding: true,
    indiaPrivateApproved: true,
    secretReference: 'ULPIN_PROVIDER_KEY_SARVAM',
    model: 'sarvam-105b',
    projectCapMicroInr: '100000000',
    projectDailyCapMicroInr: '10000000',
    principalDailyCallCap: 10,
    paceMs: 1500,
    price: {
      version: 'h20-control-only',
      inputPerMillionMicroInr: '29280000',
      cachedInputPerMillionMicroInr: '10980000',
      outputPerMillionMicroInr: '73200000',
    },
    inputBound: { version: 'control-byte-bound', maxPromptTokens: 34816 },
    timeoutMs: 1000,
  });
export class ControlLedger implements ModelCallLedger {
  calls = new Map<string, Call>();
  dispatched = 0;
  settled = 0;
  exposure = 0;
  reserved = 0;
  denyCode?: string;
  async admissionDelay() {
    return 0;
  }
  async reserve(input: Admission) {
    if (this.denyCode) throw new AppError(503, this.denyCode, 'Control admission denied.');
    this.reserved++;
    const call: Call = {
      id: randomUUID(),
      input_hash: input.inputHash,
      scope_hash: input.scopeHash,
      config_hash: hash('control'),
      state: 'reserved',
      consumer: input.consumer,
      deadline_at: input.deadlineAt,
      reserve_micro_inr: reservation(controlConfig()).toString(),
      actual_micro_inr: null,
      output: null,
      receipt: null,
      settlement_hash: null,
    };
    this.calls.set(call.id, call);
    return { call, admitted: true };
  }
  async dispatch(id: string) {
    this.dispatched++;
    this.calls.get(id)!.state = 'dispatched';
  }
  async releaseBeforeDispatch(id: string) {
    this.calls.get(id)!.state = 'released';
  }
  async retainExposure(id: string) {
    this.exposure++;
    this.calls.get(id)!.state = 'outcome_unknown';
  }
  async settle(id: string, actual: bigint, output: unknown, receipt: CallReceipt) {
    this.settled++;
    const call = this.calls.get(id)!;
    Object.assign(call, { state: 'settled', actual_micro_inr: actual.toString(), output, receipt });
    return call;
  }
}
export const unknownResponse = (request: ProviderRequest): ProviderResult => {
  const columns = JSON.parse(request.messages[1].content).columnProfile.columns;
  const output = {
    fields: columns.map((column: { sourceField: string }) => ({
      sourceField: column.sourceField,
      target: 'unknown',
      operation: { kind: 'copy' },
      confidence: 'none',
      rationale: 'Administrative context has no supported canonical target.',
    })),
  };
  return {
    output,
    responseHash: hash(output),
    httpStatus: 200,
    usage: { promptTokens: 2000, completionTokens: 1000 },
    rawResponse: { output },
  };
};
export const options = (gateway?: ModelGateway) => ({
  context: requestContext,
  gateway,
  runtime: async () => gateway,
  dataPolicy: { dataClass: 'public' as const, split: 'development' as const },
  authorize: async () => {},
});
