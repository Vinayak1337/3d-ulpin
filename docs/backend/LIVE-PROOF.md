# The first approved Sarvam run: the approval day, in order

One run, known in advance to the call and to the rupee, that produces the live receipts seven M1 boxes wait for.
Nothing here is approved yet. Every figure below was computed by `scripts/agent/live-proof.ts --plan` from the
**lead's proposal of 10 October 2026 (not approved)**; run it again with the owner's policy file and use its output.

## 1. What the owner writes into the policy

The policy is one JSON file kept outside Git. Fields, units and rules are those of
[DEMO-GATEWAY.md](DEMO-GATEWAY.md#owner-inputs); amounts are decimal strings in micro-INR (1 INR = 1,000,000).

| Field | Unit | Proposal (not approved) |
|---|---|---|
| `projectId`, `policyVersion`, `fundingVersion` | labels | the owner's own labels |
| `gatewayExclusiveFunding`, `indiaPrivateApproved` | `true` only if the owner confirms each | owner's confirmation |
| `secretReference` or `secretReferences`, `model` | names | one key name or the printed list; `sarvam-105b` |
| `projectCapMicroInr` | micro-INR, total | `"100000000"` (₹100) |
| `projectDailyCapMicroInr` | micro-INR per day | `"25000000"` (₹25) |
| `principalDailyCallCap` | calls per person per day | `150` |
| `price.version` | label of the approved tariff | the owner's label |
| `price.inputPerMillionMicroInr` | micro-INR per million input tokens | `"15000000"` (₹15) |
| `price.cachedInputPerMillionMicroInr` | micro-INR per million cached input tokens | `"5000000"` (₹5) |
| `price.outputPerMillionMicroInr` | micro-INR per million output tokens | `"60000000"` (₹60) |
| `inputBound.version`, `inputBound.maxPromptTokens` | label; tokens | plan used `34816`, the smallest allowed |
| `paceMs` | milliseconds between calls | plan used `1500`, the smallest allowed |

Left out, the optional fields take the gateway's defaults: at most 2048 output tokens per call, a 45 second
timeout, a 20% cushion on each reservation, and 30% of the total open to the document agent.

## 2. Before anything is turned on

```sh
pnpm exec tsx scripts/agent/live-proof.ts --plan --tariff <policy.json>
pnpm exec tsx scripts/agent/live-proof.ts --dry-run --tariff <policy.json>
```

The plan prints `tariff.policyHash`, the ordered steps and the totals. The dry run walks the same steps through a
gateway that holds only a replay store: its summary must say `providerDispatches: 0` and every planned request
must match (`requestsMatchingPlan` equals the number of calls). Neither command reads a key or opens a connection.

## 3. Turn the gateway on

Stop the demo API and dispatcher, then enable and start again ([DEMO-GATEWAY.md](DEMO-GATEWAY.md#commands-owner-only)):

```sh
node scripts/platform/demo-gateway.mjs enable --config <policy.json>
node scripts/platform/demo-gateway.mjs status
```

`status` must print these five facts, with the hash the plan printed for the same file, and two key counts
that must be equal (`1` and `1` for one key, `11` and `11` for a list of eleven):

```
enabled: true
policyHash: <tariff.policyHash from the plan>
providerKeyPresent: true
mappingTeacherAdapter: sarvam
dailyCapPresent: true
providerKeysNamed: <count>
providerKeysPresent: <the same count>
```

Save those seven lines to a text file. If any of the first five differs or the counts differ, stop here.

## 4. The one command the runtime owner runs

```sh
pnpm exec tsx scripts/agent/live-proof.ts --live --tariff <policy.json> --gateway-state <status.txt>
```

It runs in the demo profile's environment, as the runtime owner's task file sets it up. It refuses to start on the
proposal, on a state that is not `enabled: true`, or when the enabled hash is not the hash of `<policy.json>`.

## 5. What it costs at most

At the proposal (not approved): **10 calls; estimate ₹1.14; at most ₹7.75 of the ₹100 proposed.**

- Estimate: request bytes divided by 3 as input tokens, half the output maximum as output tokens. No tokenizer for
  the provider is in the repository, so the error of this estimate is not measured.
- Upper bound: every call held at the ledger's full reservation, ₹0.78 a call at the proposed tariff. A call cannot
  settle above its reservation without the gateway blocking the pool.
- Share of each proposed cap at most: 7.75% of the total, 30.97% of the day, 10 of 150 calls for one person,
  20.65% of the document agent's part.

## 6. The receipts, and the boxes they close

The run writes `receipt.json` and one `<sha256>.agent.json` per document into a new folder under
`E:/BhuAayam-data/task-data/s1/`. Each step's receipt carries its planned request hash, its end state and, when the
answer was recorded, its HTTP status, tokens, response hash and actual micro-INR.

| Steps | Sent | Closes | Does not close |
|---|---|---|---|
| 1: storey call on a development document | storey lines of one sanction PDF | AG-S1 | |
| 2: replay of step 1, no call | nothing | AG-S2 | if the answer failed validation |
| 3 to 8: two `mi-d10` files, 2 calls | masked column profiles | AG-E2 | ML-L2: precision has no committed n |
| 9 to 15: 7 more storey calls | storey lines | ML-D1, after offline scoring | ML-D3, AG-D1 (below) |

ML-D3 gets registry-scored development answers but no independent floor-label truth. AG-D1 gets its input (the
recorded answers) but needs the agent-to-proposal adapter, which is another task.

The two Tower 3 plan documents are asked without one OCR line each: the line begins with `[`, the gateway's text
minimizer refuses it, and the plan names it by position under `neverSent` and in the step's `omitted`.
The ledger rows themselves are read from PostgreSQL by the runtime owner and matched by request hash.

## 7. Stop rules

- Every call is one attempt. There is no repair call and no retry. With a list of keys the gateway, not this
  run, moves to the next key, and only after the provider says the key in use is used up or rejected.
- The run stops at the first refusal by the gateway, the first HTTP 402 or quota answer, the first rate limit,
  the first timeout or unknown outcome, and the first answer that could not be recorded.
- It stops before a call that, held at its full reservation, would cross the total, daily, per-person or
  document-agent cap.
- After a stop every later step asks the replay store only and ends in `needs_input` or `teacher_unavailable`;
  its receipt says `afterStop`. Changing the key is the owner's decision, never this run's.

## 8. Turn the gateway off again

Stop the demo API and dispatcher, then:

```sh
node scripts/platform/demo-gateway.mjs disable
node scripts/platform/demo-gateway.mjs status
```

`status` must print `enabled: false` and `policyHash: null`. Start the demo again; the mapping teacher is back on
replay, and the recordings made in step 4 are what it replays.
