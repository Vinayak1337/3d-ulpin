TASK   GN1 — bounded batch layouts fit real files            GATE GF1 (partial)
WORKS  A projected parcel file can be laid out and recorded; an expanded-column file reuses approved operations as a new proposal.
SEE IT node docs/evidence/gf1/gn1/run-runtime.mjs /tmp/gn1-review-new.json
INPUTS DA5 projected parcels; first NYC buildings; DA4 NYC buildings with seven added columns; NYC duplicate.
GAPS   G4 runtime blocked: the protected author call does not forward this source's SHA-256; see ownership-stop.json.
DESIGN registry.ts carries declared CRS units and token-qualified feature identity; inspection stores the raw-token fact, excluded from fingerprints.
       preparedProposal uses exact memory first, then at most 50 newest contained stored profiles; memoryPlan is unchanged and approval never transfers.
       destination and officerQuestion implement the duplicate guard and exact waiting words, but need the unowned call-site pin.
COMMITS a49d72b8 docs(usp): GN1 step 0, where a real file stops at the batch layout
        0352e3ad feat(ingestion): the batch profile takes the coordinate system the file declares
        22f14557 feat(ingestion): a unique whole number may identify a feature, as the digits the file writes
        ecceb647 feat(ingestion): reuse an approved layout when a later file only adds columns
        d43a8322 fix(ingestion): a second copy names its existing area and waits without new work
        6623a1e5 fix(ingestion): pass the authored source pin to the duplicate destination check
        40729738 fix(ingestion): keep the duplicate guard within ownership and use its stated words
        474a9745 fix(geo): keep the new inspection facts confined to GeoJSON
CHECKS pnpm typecheck:backend [0]; pnpm studio:typecheck [0]; KN2 ingestion test command [0, 233→243]; focused geo pytest [0, 120→137].
       Native adapter pytest [0, 15]; OpenAPI generate/--check [0]; pnpm studio:api-types [0]; contract refresh against base [0]; Python API check [0].
       probe.ts --after [0]; token-proof.py [0]; run-runtime.mjs [0, G1/G2/G3 true, G4 false]; git diff --check [0]. Full commands in checks.json.
NEXT   Author owner passes the SHA-256 at service.ts:221 and :266, refreshes pins and reruns the duplicate walk. No protected call changes remain in the net diff.

Numbers: 155 reviewed physical parcels, 0 building targets for DA5; NYC 1,662 raw / 1,661 recorded; DA4 1,417 ready / recorded; duplicate adds 0 areas/packages/records. Both NYC fingerprints and whole CRS objects are unchanged. All 155 DA5 normalizer keys equal raw tokens. Originals unchanged, 0 provider calls, final nonce gone.

Earlier caller-bridge evidence is diagnostic only; both unowned argument changes were reverted. Final G4 is false. The final evidence commit is listed by the final chat report / `git log`, not self-pinned here.
