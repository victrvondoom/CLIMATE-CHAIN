# Trust Firewall: threat model and trust boundaries

Status: hackathon prototype. Not audited, not certified, not endorsed by IEEE or any third party.

## The question the firewall answers

Hashing evidence proves **the bytes did not change**. It does not prove the evidence **supports the claim**.
The Trust Firewall adds that second check: given a claim and the evidence bundle behind it, does the evidence
actually establish what is being claimed, for this kind of claim, at this place and time, without being reused?

## What it enforces

| Layer | What is checked | Where |
|---|---|---|
| Integrity | Evidence digest matches the digest the claim committed to | `trust-firewall.mjs` rule 1 |
| Provenance (presence) | Source id and custody steps are present and coherent | rule 2 |
| Basis compatibility | Models cannot prove observations or carbon reductions; labels are compared as whole tokens | rule 3 |
| Freshness | Age measured from the **oldest** of retrieval time and measurement time; forecast horizon bounded to 72 h | rule 4 |
| Place | If the claim names coordinates, the evidence must come from within 25 km (5 km for methane) | rule 5 |
| Exclusivity | Same evidence digest, re-wrapped measurements, identical scope key, **and** the same activity class at the same place over an overlapping period | rule 6 |
| Contradiction | Divergent comparisons go to a human | rule 7 |
| Completeness | Some measurement or manifest must exist | rule 8 |
| **Claim-type sufficiency** (opt-in per subtype) | Does *this* evidence support *this* claim? | `claim-sufficiency.mjs`, rule 9 |
| Plausibility (opt-in) | Has a value this extreme been seen here, this season and time of day? Advisory only | `plausibility.mjs`, rule 10 |

### Claim-type-aware sufficiency profiles

| Subtype | Tier | What the evidence must show |
|---|---|---|
| `methane-response` | Quantified emissions reduction | Observed (not modelled) CH4 emission rates tagged `baseline` and `post_repair`; a repair work order that is COMPLETED, with the post-repair measurement **after** completion and the baseline **before**; a verifier who is not the claimant; a recognised methodology; evidence within 5 km; and the claimed tCO2e must not exceed the measured rate drop x claimed hours x GWP100 (30). |
| `livestock-traceability` | Intervention completion | Unique animal ids; head count that agrees with the claim; chronological custody events with no break in the chain and no gap over 30 days; an independent registry cross-check that MATCHED; and no animal already part of another active claim. |
| `air-quality` | Observation or risk alert | The claimed analyte exists in the evidence; units agree; the claimed value agrees with the evidence (latest / mean / max / min) within 5%; observations rest on non-modelled measurements; evidence within 10 km. |

Unknown claim types and subtypes fail closed (`UNKNOWN`). With `requireSubtype`, an emissions-reduction claim that
selects no supported profile is `UNKNOWN` rather than accepted. The livestock profile is exercised on synthetic data only;
it is not integrated with any real animal registry.

## Trust boundaries

1. **The bundle is an assertion.** Everything above judges the *submitted* bundle. Nothing proves it came from a
   real sensor, satellite or registry. A bundle that is internally consistent, names a plausible source and carries its
   own correct digest is accepted. This is the central limitation (case K1 in the suite).
2. **One registry.** Duplicate and overlap checks see the claims stored in this deployment's registry. They cannot see
   other registries, other chains or other deployments (case K2 shows a re-claim 8 km away that slips past the
   0.05 degree overlap cell).
3. **The chain is a development chain.** Anchoring commits bytes to a local EVM (chain id 31337, valueless ETH, reset
   when the demo ledger fills or on restart). It is not a public or immutable ledger and does not show a measurement is true.
   The contracts have unit tests and have **not** been audited.
4. **Receipts are unsigned.** A firewall receipt is JSON plus its SHA-256. Nobody signs it, and a receipt produced
   for a client-supplied claim on `POST /firewall/evaluate` is advisory. Only the opt-in enforcement gate builds the claim
   server-side.
5. **The firewall is advisory by default.** `submitClaim` and the correction flow only consult it when
   `CLIMATE_CHAIN_FIREWALL_ENFORCE=1`. When enabled, a claim that is not ACCEPTED is refused with HTTP 409 before it
   reaches the chain, and the duplicate checks read the whole registry: if it holds more than 200 claims or any stored
   evidence cannot be read, the claim is refused (HTTP 503) instead of being accepted on a partial view. A claim the
   chain then rejects is kept only as a record and stops counting as a competing claim.
6. **Methodology names, not methodologies.** The recognised-methodology check is a name allow-list. It does not audit
   the methodology.

## Data used, and how it is labelled

* `climate-chain/data/climate-hourly/` holds **91,872 city-hour rows** (six cities, 2024-11-01 to 2026-07-31).
  Columns beginning `cams_` are **modelled** Copernicus CAMS atmospheric-composition output; columns beginning `era5_` are
  ECMWF ERA5 **reanalysis**. Both are served by Open-Meteo under CC BY 4.0 (non-commercial free tier). They are not
  station observations and are never labelled as observed. Rebuild with `node gateway/scripts/fetch-climate-hourly.mjs`;
  the manifest records the SHA-256 of the data file and of every upstream response.
* `noaa_*` and `nasa_gistemp_*` files in the same folder are the public-domain **measured** series (global methane,
  Mauna Loa CO2, GISTEMP). They are stored for provenance; the timeline in the app still uses hand-keyed anchors
  (108 values), with all other years linearly interpolated and labelled `INTERPOLATED`.

## How the numbers were produced (and what they do not mean)

| Evaluation | What it is | Result |
|---|---|---|
| 55-case regression suite (`scripts/generate-adversarial-fixtures.mjs`) | Synthetic, author-written, built around the firewall's own rule categories | 27 TP / 28 TN / 0 FP / 0 FN. Perfect **by construction**: a regression check, not an accuracy claim. |
| v2 adversarial suite (`scripts/generate-adversarial-v2.mjs`, `node benchmark-runner.mjs --v2`) | 39 scored synthetic cases written **after** probing the v1 firewall's blind spots, plus 2 documented known limitations. The runner checks both the verdict and the rule code. | 39/39 pass. Not a blind test, so also not a measure of generalisation. |
| Plausibility hold-out (`scripts/evaluate-plausibility.mjs`) | Train on 2024-11 to 2026-02 (69,840 rows), test on 2026-03 to 2026-07 (22,032 **real** held-out rows). False alarms are measured on real data; detection uses **synthetic** injected spikes. | At the default margin: 0.24% held-out false-alarm rate. Injected PM2.5 spikes detected: x10 96%, x5 75%, x3 43%, x2 19%, x1.5 8%. Small deviations are largely invisible. |

The envelope is a quantile model (per city, variable, season and 6-hour block), not a neural network. It can only
route unusual values to a human; it never rejects.

## Hardening from the independent reviews

Two read-only reviews (security and correctness) of the v2 change reproduced real problems. All are fixed and have
regression tests in `tests/trust-firewall-v2.test.mjs`:

* The firewall **never throws**: non-object claims, non-array measurements, `null` entries, invalid dates, `Infinity` and
  prototype-key subtypes are rejected with a reason (previously several produced HTTP 500).
* A claimant-supplied `periodHours` is honoured only up to one year, so it cannot make 2019 data fresh, and a reduction
  can only be credited for time that has actually passed since the repair.
* Non-numeric measurement values, unusable or half-supplied coordinates, a missing retrieval time and negative emission
  rates are refused instead of passing comparisons that evaluate to `false`.
* Model labels are matched as whole tokens after splitting camelCase, with plurals, proxies, imputed/assumed values and
  negations ("NOT_MEASURED") vetoed, and emission reductions must positively present as observed.
* Units are matched by an anchored allow-list (`MtCO2e` is not tonnes), methodology by whole-token phrase ("Not IPCC" fails).
* Period parsing validates months and days, treats range ends as inclusive and fails closed on text it cannot parse.
* `POST /firewall/evaluate` cannot choose which stored claims it is compared with (it ignores a client `scope.project`
  and refuses a claim id that is already stored).
* `GET /api/v1/history/hourly` rejects unknown cities, parses the dataset once and answers from a per-city index, and is rate limited.
* The plausibility envelope is built on first use (not at cold start), caps what it reports, and gives station-style
  (non-model-labelled) readings a wider upper bound because CAMS under-predicts real peaks.

## Known limitations (also returned by the API as `knownLimitations`)

1. Fabricated but consistent evidence is accepted (K1). Closing it needs signed device/registry attestations or a
   re-fetch from the upstream source.
2. Overlap detection is local and threshold-based (K2).
3. Methodology and registry names are matched, not audited.
4. The plausibility envelope covers six cities and is silent elsewhere.
5. The livestock profile is a policy over supplied records, not an integration with a real registry.
6. The gate is off unless enabled, and receipts for client-supplied claims on `POST /firewall/evaluate` are advisory.
7. The observed-value allowance in the plausibility envelope (2x upper bound) is a documented judgement, not a measured result.

## Reproduce

```
cd climate-chain/gateway
node --test tests/*.test.mjs                 # full gateway suite
node benchmark-runner.mjs                    # 55-case regression table
node benchmark-runner.mjs --v2               # v2 adversarial suite + known limitations
node scripts/evaluate-plausibility.mjs       # real-data hold-out evaluation
node scripts/demo-trust-firewall.mjs         # live source -> rejected / accepted claims -> local-chain receipts
```
