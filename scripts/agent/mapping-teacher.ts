import { userInfo } from 'node:os';
import { profileColumnFile } from '../../packages/server/src/modules/usp/ingestion/column-profile';
import {
  proposeMappingWithTeacher,
  executeTeacherMappingDryRun,
  mappingContextFromColumnProfile,
} from '../../packages/server/src/modules/usp/ingestion/mapping-teacher';
import { mappingTeacherGatewayRuntime } from '../../packages/server/src/modules/model-gateway/runtime';
import {
  configuredGateway,
  providerKeyReferences,
  readProviderSecret,
} from '../../packages/server/src/modules/model-gateway/config';
const args = process.argv.slice(2),
  path = args[0],
  live = args.includes('--live');
if (!path || !args.includes('--public-development'))
  throw new Error(
    'Usage: mapping-teacher.ts <public-development-file> --public-development [--live] [--sheet <name>]',
  );
/** The key names of the policy. A refused policy stays the teacher's own refusal, as before. */
function policyKeyNames(): readonly string[] {
  try {
    const config = configuredGateway();
    return config ? providerKeyReferences(config) : [];
  } catch {
    return [];
  }
}
if (live) {
  // One Sarvam key or the owner's list: every named key must be present. A refusal says a name, never a value.
  const names = policyKeyNames();
  if (names.some((name) => !/^ULPIN_PROVIDER_KEY_SARVAM(_[0-9]{2})?$/.test(name)))
    throw new Error('For this one-call qualifier the policy names only ULPIN_PROVIDER_KEY_SARVAM keys.');
  const absent = names.find((name) => !readProviderSecret(name));
  if (absent) throw new Error(`For this one-call qualifier the key named ${absent} is absent.`);
}
const sheet = args.indexOf('--sheet'),
  header = args.indexOf('--header-row'),
  input = profileColumnFile(
    path,
    sheet >= 0 ? args[sheet + 1] : undefined,
    header >= 0 ? Number(args[header + 1]) : undefined,
  );
const os = userInfo();
const result = await proposeMappingWithTeacher(input.profile, {
  runtime: () => mappingTeacherGatewayRuntime(live ? 'sarvam' : 'replay'),
  maxAttempts: 1,
  context: {
    requestId: 'mapping-teacher-cli',
    principal: {
      subject: `local-os:${os.uid}:${os.username}`,
      roles: ['operator'],
      entitlementVersion: 'local-1',
      mode: 'local_demo',
    },
    accessViewId: 'mapping-teacher-cli',
    policyVersion: 'usp-local-1',
  },
  authorize: async () => {},
  dataPolicy: { dataClass: 'public', split: 'development' },
});
const execution = executeTeacherMappingDryRun(result, input.rows, {
  ...mappingContextFromColumnProfile(input.profile),
  sourceRef: path,
  rowCount: input.rows.length,
});
// Print no raw rows, credentials, raw response or provider bodies.
console.log(JSON.stringify({ result, dryRunCounts: execution.counts }, null, 2));
