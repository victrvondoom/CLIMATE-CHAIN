# Final Demo Script: ClimateChain & Trust Firewall (3–5 Minutes)

**IEEE ClimateChain Global Hackathon 2026**  
*Audited Demonstration Guide for Judges, Evaluators, and Reviewers*  
*Runs against live local stack at `http://127.0.0.1:8080/#integrity`*

---

## Pre-Demo Checklist (60 seconds before presenting)

1. Launch stack: from workspace root, run `.\start.ps1` (or `node gateway.mjs` with Hardhat node).
2. Open Chrome/Edge at 1440 px width to <http://127.0.0.1:8080/#integrity>.
3. Verify topbar status badges:
   - `LOCAL EVM · CHAIN 31337 · BLOCK <N>`
   - `LOCAL MEMORY VAULT · READY`
   - `SOURCES · 4 OF 4 CONNECTED`

---

## Demonstration Script & Timing

### 0:00 – 0:45: The Problem & The Trust Firewall Objective
- **Say**:
  > *"In climate tech and carbon accounting, the core problem is not drawing pretty dashboards or deploying speculative tokens. The fundamental vulnerability is integrity: Can an environmental claim be accepted when the underlying evidence is duplicated, altered, outdated, contradictory, derived only from a model, or insufficient to establish the claimed outcome? Today, we demonstrate the **Evidence-to-Claim Trust Firewall**."*
- **Action**: Point to the **Climate Integrity Lab** breadcrumbs (`Sense → Verify → Act → Finance → Prove`).

---

### 0:45 – 1:30: Genuine Evidence Ingestion & Cryptographic Anchoring
- **Action**:
  1. Under **1 · Choose a real signal**, select `New Delhi`, analyte `PM2.5`, mode `Live, with a labelled fallback`.
  2. Click **Fetch the signal and build evidence**.
  3. Show the resulting evidence packet: **24 hourly values**, provider `Open-Meteo CAMS`, spatial resolution `45 km grid cell`, retrieval mode `LIVE_FETCH`, and explicit WHO 2021 air quality guideline comparisons.
  4. Advance to **3 · Write and verify on-chain**. Click **Anchor evidence on the local chain**.
  5. Click **Verify independently**: Notice that the browser re-hashes the raw bundle bytes using canonical JSON and queries the local EVM contract directly over JSON-RPC.
- **Say**:
  > *"Notice what the platform explicitly states: Anchoring proves the exact bytes existed at block 1. It does NOT prove the modelled concentration is street-level reality. We label data truthfully."*

---

### 1:30 – 2:30: The Original Feature: Evidence-to-Claim Trust Firewall
- **Action**:
  1. Advance to **5 · Trust Firewall**.
  2. In the **Test Claim Tier** dropdown, select:
     `4. Quantified Emissions Reduction (Must reject pure model)`.
  3. Click **Evaluate through Trust Firewall**.
  4. Show the immediate verdict:
     - Badge: `FIREWALL VERDICT · REJECTED`
     - Violation: `Model-to-Carbon Prohibition: Modelled air concentrations or simulations (MODEL_FORECAST) cannot prove physical avoided emissions or carbon reduction.`
  5. Now switch the dropdown to:
     `1. Physical Observation (Must reject model forecast)`.
  6. Click **Evaluate through Trust Firewall**.
  7. Show the second violation:
     - Violation: `Model-to-Observation Prohibition: A modelled reading cannot be accepted as independently observed environmental pollution.`
  8. Now switch the dropdown to:
     `2. Environmental Risk Alert (Allows model with uncertainty)`.
  9. Click **Evaluate through Trust Firewall**.
  10. Show the success verdict:
     - Badge: `FIREWALL VERDICT · ACCEPTED`
     - Badge: `ELIGIBLE FOR ON-CHAIN ANCHORING`
     - Emits `FirewallReceipt` with canonical SHA-256 hash.
- **Say**:
  > *"Different environmental claims demand fundamentally different evidence tiers. A modelled air concentration can legitimately power a 48-hour health advisory alert, but must NEVER be converted into offset credits or presented as empirical pollution."*

---

### 2:30 – 3:30: Reproducible 55-Case Adversarial Benchmark
- **Action**:
  1. Click **Run 55-Case Adversarial Benchmark**.
  2. Display the live comparative benchmark table:
     - **Baseline A (Hash-Only)**: Precision `54.0%`, Unsafe-Claim Acceptance Rate `82.1%` (fails on models, stale data, duplicate scopes).
     - **Baseline B (Existing Registry)**: Precision `58.7%`, Unsafe-Claim Acceptance Rate `67.9%` (evaded by generating new claim IDs).
     - **Baseline C (Trust Firewall)**: Precision `100.0%`, Unsafe-Claim Acceptance Rate `0.0%`, Average Latency `0.117 ms`.
- **Say**:
  > *"On 55 labelled adversarial cases spanning five biomes, hash-only verification accepts 82% of fraudulent claims. The Trust Firewall completely eliminates unsafe acceptance without falsely rejecting legitimate co-located activities."*

---

### 3:30 – 4:30: Exclusivity Locks, Anti-Double-Counting & Lineage
- **Action**:
  1. Advance to **6 · Claim**. Click **Submit the demo claim**. Show the locked scope and block commitment.
  2. Click **Submit the same claim again**.
  3. Show the EVM revert: `REJECTED BY CONTRACT · DuplicateClaim` (status 0).
  4. Advance to **7 · Challenge**. Select reason `MODEL_NOT_OBSERVATION`. Click **Submit the challenge**.
  5. Click **Approve a correction**. Show that the original claim is marked `Superseded`, the new evidence is linked to its parent ID, and the entire audit trail is preserved on-chain.
- **Say**:
  > *"History is never erased or silently rewritten. Superseded records remain verifiable on-chain with full cryptographic parentage."*

---

### 4:30 – 5:00: Terminal Verification & Conclusion
- **Action**:
  1. Expand **Reproduce from a terminal**.
  2. Point out the zero-dependency `curl` commands to inspect contract state directly.
- **Say**:
  > *"Climate Chain delivers demonstrable technical novelty: one independently reproducible, mathematically sound environmental verification workflow with zero speculative tokens. Thank you."*

---

## Terminal Quick-Commands for Evaluators

```powershell
# 1. Run the Trust Firewall Adversarial Benchmark
cd climate-chain/gateway
node benchmark-runner.mjs

# 2. Run all Gateway & Firewall Unit Tests
node --test tests/trust-firewall.test.mjs

# 3. Check Smart Contract Gas & Unit Tests
cd ../blockchain
npm test

# 4. Verify Frontend TypeScript & 510 Unit Tests
cd ../frontend
npm test
npm run lint
```
