# Demo model gateway

The demo profile runs with the model gateway **off** unless the owner turns it on with a policy they wrote.
`platform:start --profile demo --create` always writes `ULPIN_MODEL_GATEWAY_ENABLED=0`; nothing turns it on by itself.

## The two states

The external demo configuration is accepted in exactly two states of `ULPIN_MODEL_GATEWAY_ENABLED`:

- **`0` (off):** no `ULPIN_MODEL_GATEWAY_CONFIG` line and no `ULPIN_MAPPING_TEACHER_ADAPTER=sarvam` line.
- **`1` (on):** all of
  - a `ULPIN_MODEL_GATEWAY_CONFIG` policy that the gateway schema accepts;
  - it names its key one way: `secretReference`, exactly `ULPIN_PROVIDER_KEY_SARVAM`, or `secretReferences`, a
    list of 2 to 32 different names of the form `ULPIN_PROVIDER_KEY_SARVAM_01`, in the order the keys are used;
  - it states `projectDailyCapMicroInr`;
  - every key it names is present and not empty. A refusal names the first missing name.

Any other flag value, or a mix of the two states, is refused. Refusals name the key, never a value.

## Which check runs where

- **`readDemo()`** (`scripts/platform/demo-config.mjs`, through `readDemoSettings()`) runs for start, doctor and
  `status`, and on the copy that `enable` and `disable` write. It checks the flag, the key reference, that the key is
  present and that the daily cap is stated. For `1` it then runs the one `ModelGatewayConfigSchema` in TypeScript
  (`gatewayPolicyHash()`), in a child process that receives the policy and not the key. The schema is not copied.
- **Each gateway use** in the API and dispatcher parses the same schema again (`configuredGateway()`); an invalid policy
  fails that request with `MODEL_CONFIGURATION`. The API does not check the policy when it starts.
- **`pnpm platform:doctor --profile demo`** prints `Model gateway state` with seven facts: `enabled`, `policyHash`
  (`modelGatewayPolicyHash()`, or `null` when off), `providerKeyPresent`, `mappingTeacherAdapter`
  (`replay`, `sarvam` or `manual`, as the runtime resolves it), `dailyCapPresent`, `providerKeysNamed` and
  `providerKeysPresent`. When on, `providerKeysNamed` counts the names in the policy, `providerKeysPresent` counts
  those that hold a value, and `providerKeyPresent` is `true` only when the two are equal. When off, no policy names
  a key: `providerKeysNamed` is `0` and `providerKeysPresent` counts the Sarvam key lines that hold a value.

## Commands (owner only)

Run them from the checkout that serves the demo ([DEMO-RUNTIME.md](DEMO-RUNTIME.md)). `enable` and `disable` refuse
while the demo's API or dispatcher is recorded as running, because a running process would not see the change: stop
those two first (roll-out step 2 there, or `pnpm platform:stop --profile demo`), then start the demo again.

```sh
node scripts/platform/demo-gateway.mjs status
node scripts/platform/demo-gateway.mjs enable --config <policy.json>
node scripts/platform/demo-gateway.mjs disable
```

- `status` prints the same seven facts as the doctor. It never reads the ledger, so it works with the database
  stopped and does not say how many keys are used up; `key-marks` below does.
- `enable` sets the flag to `1`, writes the policy as one line and sets `ULPIN_MAPPING_TEACHER_ADAPTER=sarvam`.
  `disable` sets the flag to `0`, removes the policy line and removes the adapter line when it selects `sarvam`.
- Both rewrite only those three lines. Every other byte and the newline style stay as they are; the result is written
  beside the file, checked by the same reader and only then renamed over it. They print key names, never values.
- `enable` followed by `disable` restores the configuration byte for byte. The one exception is an adapter line that
  was already there: `enable` overwrites it and `disable` removes it.

## A list of keys: the owner's steps in order

The gateway uses one key at a time: the first key of the list that is not marked used up. It moves to the next
only when Sarvam answers about the key itself: HTTP 429 with `insufficient_quota_error` (credits used up) or
HTTP 403 with `invalid_api_key_error` (key rejected). That call is closed without charge, the key is marked, and
the next call uses the next key. A rate limit, a timeout, a 5xx and any other answer move nothing. The caps, the
pace and the one call in flight count across all keys together.

1. **Put the keys in** (demo stopped). Make a text file outside Git with one key per line, in the order of use.

   ```sh
   node scripts/platform/demo-gateway.mjs keys --from <keys file>
   ```

   It prints `11 keys written as ULPIN_PROVIDER_KEY_SARVAM_01 to ULPIN_PROVIDER_KEY_SARVAM_11` and the
   `secretReferences` line for the policy file; never a value. It replaces the numbered key lines and leaves every
   other line as it is. Then delete the text file. To rehearse, add
   `--dry-run --out <empty folder> --settings <a synthetic settings file>`: the result is written to that folder
   and the line says `would be written`. A rehearsal never reads the demo settings, because its result holds the
   whole settings text with the keys in it; use synthetic keys and delete the folder afterwards.
2. **Enable with the policy file.** In the policy, replace `secretReference` by the printed `secretReferences`.

   ```sh
   node scripts/platform/demo-gateway.mjs enable --config <policy.json>
   ```

   It prints `Changed: ...` and the seven facts.
3. **Status.** `node scripts/platform/demo-gateway.mjs status` must print `enabled: true`, the policy hash,
   `providerKeyPresent: true`, `mappingTeacherAdapter: sarvam`, `dailyCapPresent: true`,
   `providerKeysNamed: 11` and `providerKeysPresent: 11`.
4. **Start** the demo ([DEMO-RUNTIME.md](DEMO-RUNTIME.md)). The start applies the additive ledger columns and the
   key-marks table. If the ledger was pinned to another key or list, every paid call is refused with
   `MODEL_RECONCILIATION_REQUIRED` until the owner runs, with the database up and the API stopped:

   ```sh
   node scripts/platform/demo-gateway.mjs reconcile --reason "<why the keys changed>"
   ```

   It prints `key list: reconciled` (or `unchanged`, or `unpinned` for a ledger that has no call yet). It is
   refused when anything but the keys differs from the pinned policy, and while a call has unresolved exposure.
5. **The live proof**: [LIVE-PROOF.md](LIVE-PROOF.md).
6. **Disable**: stop the demo, `node scripts/platform/demo-gateway.mjs disable`, start it again.

With the database up, two more owner commands read or change the marks:

```sh
node scripts/platform/demo-gateway.mjs key-marks
node scripts/platform/demo-gateway.mjs restore-key ULPIN_PROVIDER_KEY_SARVAM_03 --reason "<what changed>"
```

`key-marks` prints one line per name: `in_use`, `waiting`, or `used_up` with the reason and the time.
`restore-key` closes the mark with the owner's reason and time; nothing else ever does. Adding, removing,
reordering or replacing a key is steps 1, 2 and the `reconcile` of step 4; a used-up key stays marked wherever
the new list puts it.

## Owner inputs

Keep the policy file outside Git. Amounts are decimal strings in micro-INR (1 INR = 1,000,000 micro-INR). Labels use
letters, digits and `_ . : / -`. Only the owner can state these; the repository holds no default for any of them.

| Field | Unit / meaning |
|---|---|
| `projectId`, `policyVersion`, `fundingVersion` | labels for this project, this policy and the approved funding |
| `gatewayExclusiveFunding`, `indiaPrivateApproved` | `true` only if the owner confirms each statement |
| `projectCapMicroInr` | micro-INR, total for the project |
| `projectDailyCapMicroInr` | micro-INR per day (required for the demo) |
| `principalDailyCallCap` | calls per principal (operator) per day |
| `price.version` | label of the approved tariff |
| `price.inputPerMillionMicroInr` | micro-INR per million input tokens |
| `price.cachedInputPerMillionMicroInr` | micro-INR per million cached input tokens |
| `price.outputPerMillionMicroInr` | micro-INR per million output tokens |
| `inputBound.version`, `inputBound.maxPromptTokens` | label of the qualified bound; tokens |
| `paceMs` | milliseconds between calls |
| `ingestProtectedBps`, `cushionBps` | optional; basis points |
| `maxOutputTokens`, `timeoutMs` | optional; tokens, milliseconds |

```json
{
  "projectId": "", "policyVersion": "", "fundingVersion": "",
  "gatewayExclusiveFunding": null, "indiaPrivateApproved": null,
  "secretReference": "ULPIN_PROVIDER_KEY_SARVAM", "model": "sarvam-105b",
  "projectCapMicroInr": "", "projectDailyCapMicroInr": "", "principalDailyCallCap": null,
  "price": { "version": "", "inputPerMillionMicroInr": "", "cachedInputPerMillionMicroInr": "",
    "outputPerMillionMicroInr": "" },
  "inputBound": { "version": "", "maxPromptTokens": null },
  "paceMs": null
}
```

Ranges are in `packages/server/src/modules/model-gateway/config.ts`. This empty template is refused as it stands.

### Approved on 10 October 2026, and the pending file

The owner approved these values on 10 October 2026. Each is counted across all keys together.

| Field | Approved | In the file |
|---|---|---|
| `price.inputPerMillionMicroInr` | ₹15 per million input tokens | `"15000000"` |
| `price.cachedInputPerMillionMicroInr` | ₹5 per million cached input tokens | `"5000000"` |
| `price.outputPerMillionMicroInr` | ₹60 per million output tokens | `"60000000"` |
| `projectCapMicroInr` | at most ₹100 in total | `"100000000"` |
| `projectDailyCapMicroInr` | at most ₹25 a day | `"25000000"` |
| `principalDailyCallCap` | 150 calls per person per day | `150` |
| `secretReferences` | the owner's eleven keys, in order | `ULPIN_PROVIDER_KEY_SARVAM_01` to `_11` |

The policy written from them is `E:/BhuAayam-data/task-data/gk2/demo-gateway-policy.pending.json`, outside Git
(SHA-256 `d3a4576f564383185c3fd4fc4d99f1e7b43d6c2776fed755596d55d73c888969`). It is pending because the owner has not
yet confirmed two statements. Both are `null` in the file, so the gateway refuses it as it stands.

- `gatewayExclusiveFunding`: yes means the credit behind these keys is spent only through this gateway. Nobody
  uses any of the keys anywhere else, so the gateway's own ledger is the whole account of what was spent.
- `indiaPrivateApproved`: yes means the owner approves Sarvam as this project's India-private route for the
  minimised text the gateway sends, on Sarvam's own word about hosting, logs, retention and training. The code
  does not check any of that.

Not part of the owner's approval: `inputBound` (`34816` tokens, labelled `schema-minimum/not-approved`) and `paceMs`
(`1500`) are the smallest values the schema allows, as the live-proof plan uses them. `maxOutputTokens` `2048`,
`timeoutMs` `45000`, `cushionBps` `2000` and `ingestProtectedBps` `7000` are the schema's defaults, written out.

With both statements `true` the same content is accepted, with policy hash
`efb90b3a440a875d80314024d30482abbc7c4c14a6e3682cd5ec946567dc6721`; any other change gives another hash. The check
reads only the file it is given and sends nothing:

```sh
pnpm exec tsx --tsconfig apps/api/tsconfig.json docs/evidence/gf-ai/gateway/gk2/check-policy.ts <policy.json>
```

## Fail-closed behaviour

- **One key at a time.** Only the keys the policy names are ever used, in the owner's order, never in turn and
  never two for one call. No code reads `sarvam-staged.env`. Changing the keys is the owner's step.
- **A key is missing:** flag `1` is refused, so the demo does not start in that state. With flag `0` the mapping
  teacher replays recordings, or stays manual if the adapter line says so.
- **One key used up or rejected (a list):** that call fails once with `MODEL_QUOTA_EXHAUSTED` or
  `MODEL_CREDENTIAL_INVALID`, closed at zero, and falls back to a manual plan; the next call uses the next key.
  With a single `secretReference` the pool is blocked as before.
- **Every key used up:** paid calls are refused with `MODEL_KEYS_EXHAUSTED` before anything is sent; the request
  falls back to a manual mapping plan. To return to replay, stop the demo, run `disable`, and start it.
- **Rate limit, timeout or no network:** the call fails once, its reservation stays held and no other key is
  tried. Sarvam states that all keys of one account share one rate limit.
- Teacher outputs stay `pseudo_label` candidates; nothing here writes the registry.
