// GK2: one command that asks the gateway's own schema about the pending policy file. It sends nothing and reads
// only the file it is given. The two owner statements are set to true in memory only, never in the pending file.
// Usage: tsx docs/evidence/gf-ai/gateway/gk2/check-policy.ts <pending.json> [--planning-copy <file>]
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import {
  ModelGatewayConfigSchema, hash, providerKeyReferences,
} from '../../../../../packages/server/src/modules/model-gateway/config';

const statements = ['gatewayExclusiveFunding', 'indiaPrivateApproved'];
const usage = 'Usage: check-policy.ts <pending.json> [--planning-copy <...approved-form-for-planning.json>]';
const [file, flag, copy] = process.argv.slice(2);
if (!file || (flag !== undefined && (flag !== '--planning-copy' || !copy))) throw new Error(usage);

const bytes = readFileSync(file);
const pending = JSON.parse(bytes.toString('utf8'));
const asWritten = ModelGatewayConfigSchema.safeParse(pending);
const approvedForm = { ...pending, ...Object.fromEntries(statements.map(name => [name, true])) };
const approved = ModelGatewayConfigSchema.safeParse(approvedForm);

if (copy) {
  // The plan reads a file, so the in-memory form is written once under a name that says what it is for.
  const named = basename(copy).endsWith('approved-form-for-planning.json');
  if (!named || /[\\/]runtime[\\/]/i.test(resolve(copy))) throw new Error(usage);
  writeFileSync(copy, `${JSON.stringify(approvedForm, null, 2)}\n`, { flag: 'wx' });
}

const names = approved.success ? providerKeyReferences(approved.data) : [];
const refusedOn = asWritten.success ? []
  : asWritten.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`);
console.log(JSON.stringify({
  file: basename(file),
  sha256: createHash('sha256').update(bytes).digest('hex'),
  asWritten: { accepted: asWritten.success, refusedOn },
  withBothStatementsTrueInMemory: {
    accepted: approved.success,
    policyHash: approved.success ? hash(approved.data) : null,
    keyNames: { count: names.length, first: names[0] ?? null, last: names.at(-1) ?? null },
    planningCopyWritten: copy ? basename(copy) : null,
  },
}, null, 2));
