# Evidence-to-Claim Trust Firewall: Evaluation Report

**IEEE ClimateChain Global Hackathon 2026.** Hackathon submission; not certified, audited or endorsed by IEEE or any third party.

This report says what was measured, how, and what the numbers do **not** show. Every figure is reproducible with the
command beside it. Trust boundaries and known limitations: [`climate-chain/docs/THREAT_MODEL.md`](../climate-chain/docs/THREAT_MODEL.md).

## 1. The 55-case regression suite (synthetic, author-written)

`climate-chain/gateway/scripts/generate-adversarial-fixtures.mjs` generates 55 cases across 5 sites: valid claims in each
of the four tiers, tampered evidence, model data presented as an observation, model data presented as carbon reduction,
stale evidence, a new claim id on an existing scope, co-located but distinct activities, broken custody and contradictory
sources. Labels were set by the same authors who wrote the rules.

| System | TP | FP | TN | FN | Unsafe accepted |
|---|---:|---:|---:|---:|---:|
| A: hash only | 27 | 23 | 5 | 0 | 82.1% |
| B: hash + exact scope key (as defined by the authors) | 27 | 19 | 9 | 0 | 67.9% |
| C: Trust Firewall | 27 | 0 | 28 | 0 | 0% |

`node benchmark-runner.mjs`. Latency is about 0.1 ms per claim on the author's machine.

**How to read it.** C's perfect score is *by construction*: the cases were written around the firewall's own rule
categories. A and B are baselines the authors defined, so their weak scores are not a comparison with any external system.
This suite is a **regression check**, not an accuracy, fraud-detection or security evaluation. It also does not check which
rule fired, so a case rejected for the wrong reason still counts as correct (the v2 suite fixes that).

## 2. The v2 adversarial suite (synthetic, written after probing v1)

We probed the v1 firewall with 21 hand-written attacks and genuine-but-unusual claims; it wrongly accepted 16 and wrongly
rejected 2. Those probes, plus subtype cases, became `scripts/generate-adversarial-v2.mjs`. The runner checks the expected
**verdict and the expected rule code**.

`node benchmark-runner.mjs --v2` (also exits non-zero on any failure, so CI can gate on it):

| Group | Cases | Passing |
|---|---:|---:|
| Fixed blind spots (wrong place, label tricks, hidden modelled value, overlap by synonym / nested period / relabelled boundary / re-wrapped evidence, stale-data laundering, unbounded forecast, cancelled or dispatch-only interventions, invented claim type, and two genuine claims v1 wrongly rejected) | 20 | 20 |
| Claim-type sufficiency (methane response 8, livestock traceability 7, air quality 4) | 19 | 19 |
| **Known limitations** (unsafe claims the firewall accepts, documented on purpose) | 2 | n/a |

**Not a blind test.** The cases were written by us *after* seeing what v1 got wrong, so 39/39 shows the fixes work and keep
working, not that the firewall generalises. The independent reviews of this change then found further problems the suite
had not covered (hostile input shapes, unbounded `periodHours`, unit and label evasion, a fail-open registry read); they
are fixed and each has its own regression test in `tests/trust-firewall-v2.test.mjs`.

## 3. What the firewall cannot detect (counterexamples in the suite)

* **K1: fabricated-but-consistent evidence.** An invented Delhi monitor reading, internally consistent, naming a plausible
  source and carrying its own correct digest, is ACCEPTED. The firewall judges the bundle, not the sensor.
* **K2: overlap threshold.** The same leak repair re-claimed about 8 km away under a different label slips past the 0.05
  degree overlap cell.

Closing K1 needs signed attestations from devices or registries, or a re-fetch from the upstream source at verification time.

## 4. Plausibility envelope: real held-out data

`node scripts/evaluate-plausibility.mjs`. A per-city, per-variable, per-season, per-6-hour-block quantile model fitted on
69,840 rows (2024-11 to 2026-02) and evaluated on 22,032 **real** rows it never saw (2026-03 to 2026-07). The data is CAMS
(modelled) and ERA5 (reanalysis), not station observations.

At the default margin (0.25):

| Measure | Result |
|---|---|
| False alarms on real held-out values | 0.24% overall (PM2.5 0.91%, PM10 0.43%, NO2 0.14%, CH4 0.25%, temperature 0.06%) |
| Detection of **synthetic** injected spikes, PM2.5 | x10: 96%, x5: 75%, x3: 43%, x2: 19%, x1.5: 8% |
| Detection of synthetic spikes, methane | x3: 98%, x2: 88% (methane is very stable in CAMS) |

It only catches large deviations, it is silent outside the six covered cities, and it routes to a human rather than rejecting.
Observed (non-model-labelled) values get a 2x wider upper bound because CAMS under-predicts real station peaks; that
allowance is a judgement and is **not** covered by this evaluation.

## 5. What we have not done

* No external or blind evaluation; no real fraud corpus exists for these claim types.
* The livestock profile has only been exercised on synthetic records; it is not integrated with a real registry.
* No formal verification and no external security audit of the firewall or the contracts. Two internal reviews (security
  and correctness) were run on this change; their findings are fixed and tested.
* Receipts are unsigned and the chain is a local development chain, so anchoring shows bytes were recorded, not that they are true.
