# Test Results, Suite Status, and Failure Summary

**IEEE ClimateChain Global Hackathon 2026**  
*Self-reported Execution Record | Timestamp: 24 October 2026 | counts are a snapshot; run npm test for current counts*

---

## 1. Complete Test Suite Execution Summary

Every test suite across the smart contract, backend gateway, and frontend applications was executed directly in this workspace by the project authors (self-reported snapshot; counts differ from other documents because tests were added over time, run npm test for current counts).

| Component / Subsystem | Test Framework | Total Tests | Passing | Failing | Skipped | Execution Command | Result |
|---|---|---|---|---|---|---|---|
| **Blockchain Smart Contracts** | Hardhat / Mocha / Chai | 19 | **19** | 0 | 0 | `cd blockchain && npm test` | **PASS (100%)** |
| **Gateway & Trust Firewall** | Node.js Native Runner (`node:test`) | 174 | **173** | 0 | **1** | `cd gateway && npm test` | **PASS (99.4%)** |
| **Frontend Component & Domain Suites** | Vitest (72 test files) | 510 | **510** | 0 | 0 | `cd frontend && npm test` | **PASS (100%)** |
| **Frontend Code Quality & Lint** | ESLint | — | — | 0 | 0 | `cd frontend && npm run lint` | **PASS (0 errors, 0 warnings)** |
| **Frontend Production Build** | TypeScript (`tsc --noEmit`) + Vite | — | — | 0 | 0 | `cd frontend && npm run build` | **PASS (0 errors)** |

---

## 2. Granular Breakdown by Component

### A. Blockchain Contracts (`climate-chain/blockchain`)
Command: `npm test`  
Environment: Hardhat Local Node (EVM version Cancun / Solidity 0.8.24)  
Summary: 19 passing tests (3.2 seconds)

- `EvidenceAnchor.sol`:
  - Records manifest digest and exposes block commitment (Passed)
  - Rejects duplicate digest with `DigestAlreadyAnchored` custom error (Passed)
  - Rejects empty digest with `EmptyDigest` (Passed)
- `EnvironmentalEvidenceRegistry.sol`:
  - Anchors digest under evidence ID and exposes immutable record (Passed)
  - Accepts writes only from authorized attesters (`NotAttester`) (Passed)
  - Rejects empty IDs and digests (Passed)
  - Rejects replayed evidence ID and duplicate bytes (Passed)
  - Links corrections to parent record with full history retention (Passed)
  - Rejects unknown parents and secondary corrections of same record (Passed)
  - Enforces bounded gas cost ceiling (Passed)
- `ClimateClaimRegistry.sol`:
  - Records claim against anchored evidence and locks exclusivityKey (Passed)
  - Enforces role-based access for claimant and reviewer (Passed)
  - Rejects duplicate active claim for same scope or same evidence ID (Passed)
  - Refuses claims backed by missing or superseded evidence (Passed)
  - Enables public challenge submission while restricting resolution to unconflicted reviewers (Passed)
  - Reinstates dismissed challenges and releases scope on upheld challenge (Passed)
  - Supersedes challenged claims via correction lineage (Passed)
  - Verifies zero token/minting surface (Passed)
  - Enforces bounded gas cost (Passed)

### B. Gateway & Trust Firewall (`climate-chain/gateway`)
Command: `npm test`  
Environment: Node.js 22 LTS  
Summary: 173 passing, 1 skipped, 0 failing (5.07 seconds)

- **Trust Firewall Suite** (`tests/trust-firewall.test.mjs`):
  - Deterministic collision-resistant composite scope key generation (Passed)
  - Model-to-Observation Prohibition strictly blocks simulated data (Passed)
  - Model-to-Carbon Prohibition strictly blocks model-derived emission credits (Passed)
  - Hash tampering detection immediately rejects altered payload (Passed)
  - Duplicate scope with distinct claim ID is detected and rejected (Passed)
  - Legitimate co-located distinct activities on same location are accepted (Passed)
  - Full 55-case Adversarial Benchmark meets precision and recall targets (Passed)
- **Place & Environmental Routing** (`tests/place-environment.test.mjs`):
  - Validates coordinate bounds, sanitizes injected values (Passed)
  - Queries weather and air in parallel with explicit model provenance (Passed)
  - Rejects missing greenhouse fields without inventing zeros (Passed)
  - 5-minute cache with bounded cardinality (Passed)
- **Durable Mission Engine & Memory Vault** (`tests/mission-*.test.mjs`, `tests/memory-*.test.mjs`):
  - DAG execution survives process restart (Passed)
  - Windows DPAPI / AES-256-GCM memory encryption and audit logging (Passed)
  - Background worker lease recovery and bounded backoff (Passed)

### C. Frontend Web Application (`climate-chain/frontend`)
Command: `npm test`  
Environment: Vitest v4.1.12 (72 test files)  
Summary: 510 passing tests (5.56 seconds)

- Verified coverage over all domain modules:
  - `integrity/verify.test.ts` (9 tests)
  - `modules/carbontwin/domain/*` (18 tests)
  - `modules/grounded/domain/*` (18 tests)
  - `modules/hourmatch/domain/*` (25 tests)
  - `modules/plume/domain/*` (29 tests)
  - `modules/clearsky/domain/*` (19 tests)
  - `modules/carbonshield/domain/*` (17 tests)
  - `modules/earth/*` (28 tests)
  - `modules/vayu/domain/*` (26 tests)
  - `modules/junksnap/domain/*` (14 tests)
  - `modules/plotlock/domain/*` (23 tests)
  - `modules/ecograph/domain/*` (26 tests)

---

## 3. Honest Disclosure of Skipped Test & Environmental Limitations

### The 1 Skipped Test: `integrity-e2e.test.mjs`
- **Location**: `gateway/tests/integrity-e2e.test.mjs:22`
- **Assertion**: `test('full path: evidence, anchor, verify, tamper, replay, claim, duplicate, challenge, correction', { skip: !enabled && 'set CLIMATE_CHAIN_E2E=1 with a local chain running' })`
- **Reason**: This is an integration test designed to execute against a live Hardhat node running on `127.0.0.1:18545`. When running offline unit test suites without `start.ps1`, it skips gracefully. When `CLIMATE_CHAIN_E2E=1` is provided with the local chain running, all 9 assertions pass.

### Scientific & Operational Limitations
1. **Modelled Air Quality vs. Ground Observations**:
   Open-Meteo CAMS provides near-surface concentrations on a 45 km grid cell. It provides broad atmospheric context, not a calibrated street-level monitor measurement. The Trust Firewall explicitly flags this and refuses to allow CAMS data to be claimed as an observed measurement.
2. **Local EVM Chain Deployment**:
   Smart contracts are deployed to a local Hardhat development chain (`chainId: 31337`). No public-network or testnet deployment was attempted. Local development EVM (Hardhat/EDR, chain ID 31337, valueless ETH, reset on restart or when the demo ledger fills). Anchoring shows the recorded bytes were committed to this chain. It is not a public or immutable ledger and does not show a measurement is true.
3. **Third-Party Service Isolation**:
   The central gateway normalizes live data from JunkSnap, ClearSky, Teesri Shikayat, and Vayu. The remaining modules are native re-implementations in climate-chain/frontend/src/modules that run on bundled fixtures (8 SIMULATED, 6 RESEARCH, 4 DEMO); the original project folders are not included in this repository. No unified totals are fabricated.
