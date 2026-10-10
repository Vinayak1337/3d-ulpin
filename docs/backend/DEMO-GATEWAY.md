# Demo model gateway

The demo profile runs with the model gateway **off** unless the owner turns it on with a policy they wrote.
`platform:start --profile demo --create` always writes `ULPIN_MODEL_GATEWAY_ENABLED=0`; nothing turns it on by itself.

## The two states

The external demo configuration is accepted in exactly two states of `ULPIN_MODEL_GATEWAY_ENABLED`:

- **`0` (off):** no `ULPIN_MODEL_GATEWAY_CONFIG` line and no `ULPIN_MAPPING_TEACHER_ADAPTER=sarvam` line.
- **`1` (on):** all of
  - a `ULPIN_MODEL_GATEWAY_CONFIG` policy that the gateway schema accepts;
  - its `secretReference` is exactly `ULPIN_PROVIDER_KEY_SARVAM`, and it states `projectDailyCapMicroInr`;
  - `ULPIN_PROVIDER_KEY_SARVAM` is present and not empty.

Any other flag value, or a mix of the two states, is refused. Refusals name the key, never a value.

## Which check runs where

- **`readDemo()`** (`scripts/platform/demo-config.mjs`, through `readDemoSettings()`) runs for start, doctor and
  `status`, and on the copy that `enable` and `disable` write. It checks the flag, the key reference, that the key is
  present and that the daily cap is stated. For `1` it then runs the one `ModelGatewayConfigSchema` in TypeScript
  (`gatewayPolicyHash()`), in a child process that receives the policy and not the key. The schema is not copied.
- **Each gateway use** in the API and dispatcher parses the same schema again (`configuredGateway()`); an invalid policy
  fails that request with `MODEL_CONFIGURATION`. The API does not check the policy when it starts.
- **`pnpm platform:doctor --profile demo`** prints `Model gateway state` with five facts: `enabled`, `policyHash`
  (`modelGatewayPolicyHash()`, or `null` when off), `providerKeyPresent`, `mappingTeacherAdapter`
  (`replay`, `sarvam` or `manual`, as the runtime resolves it) and `dailyCapPresent`.

## Commands (owner only)

Run them from the checkout that serves the demo ([DEMO-RUNTIME.md](DEMO-RUNTIME.md)). `enable` and `disable` refuse
while the demo's API or dispatcher is recorded as running, because a running process would not see the change: stop
those two first (roll-out step 2 there, or `pnpm platform:stop --profile demo`), then start the demo again.

```sh
node scripts/platform/demo-gateway.mjs status
node scripts/platform/demo-gateway.mjs enable --config <policy.json>
node scripts/platform/demo-gateway.mjs disable
```

- `status` prints the same five facts as the doctor.
- `enable` sets the flag to `1`, writes the policy as one line and sets `ULPIN_MAPPING_TEACHER_ADAPTER=sarvam`.
  `disable` sets the flag to `0`, removes the policy line and removes the adapter line when it selects `sarvam`.
- Both rewrite only those three lines. Every other byte and the newline style stay as they are; the result is written
  beside the file, checked by the same reader and only then renamed over it. They print key names, never values.
- `enable` followed by `disable` restores the configuration byte for byte. The one exception is an adapter line that
  was already there: `enable` overwrites it and `disable` removes it.

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

## Fail-closed behaviour

- **One key.** Only `ULPIN_PROVIDER_KEY_SARVAM` in the demo configuration is ever used. No code lists, chooses or
  rotates keys, and no code reads `sarvam-staged.env`. Changing the key is the owner's edit.
- **No key:** flag `1` is refused, so the demo does not start in that state. With flag `0` the mapping teacher
  replays recordings, or stays manual if the adapter line says so.
- **No credit or no network:** the live call fails once and that request falls back to a manual mapping plan with a
  reason code. Nothing retries on another key. To return to replay, stop the demo, run `disable`, and start it.
- Teacher outputs stay `pseudo_label` candidates; nothing here writes the registry.
