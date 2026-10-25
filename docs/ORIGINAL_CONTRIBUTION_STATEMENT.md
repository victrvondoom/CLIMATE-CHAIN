# Original Contribution Statement

**IEEE ClimateChain Global Hackathon 2026**  
*Project: Climate Chain — Evidence-to-Claim Trust Firewall & Unified Environmental Verification Framework*

---

## 1. Primary Original Contribution: The Evidence-to-Claim Trust Firewall

The primary original technical contribution developed for the IEEE ClimateChain hackathon is the **Evidence-to-Claim Trust Firewall** (`gateway/trust-firewall.mjs`).

### The Problem Addressed
In contemporary carbon markets and climate hackathons, an acute vulnerability exists:
> *"Can an environmental claim be accepted when the underlying evidence is duplicated, altered, outdated, contradictory, derived only from a model, or insufficient to establish the claimed outcome?"*

Most existing platforms either:
1. Merely hash arbitrary JSON payloads into an EVM contract ("hash-only baseline"), which falsely accepts model forecasts masquerading as real-world emissions reductions, stale data, and duplicate claims evading IDs.
2. Present decorative dashboards detached from rigorous evidence rules and physical measurement realities.

### The Solution: Multi-Tiered Deterministic Policy Engine
The Trust Firewall implements deterministic rule checks (no formal verification) distinguishing four distinct environmental claim tiers:

1. **`ENVIRONMENTAL_OBSERVATION`**:
   - **Evidence Requirement**: Strictly requires direct physical sensor or calibrated satellite observation (`OBSERVED_MONITOR`, `SATELLITE_MEASURED`, `COMMUNITY_REPORT`).
   - **Model-to-Observation Prohibition**: Rejects pure model forecasts (`MODEL_FORECAST`) or ungrounded simulations claiming to be observed environmental pollution (`MODEL_CANNOT_PROVE_OBSERVATION`).
   - **Freshness**: Bounded to $\le 48\text{ hours}$ for terrestrial sensors and $\le 7\text{ days}$ for satellite revisits.
2. **`ENVIRONMENTAL_RISK_ALERT`**:
   - **Evidence Requirement**: Permits predictive model forecasts (`MODEL_FORECAST`, `PREDICTIVE_RADAR`), but strictly mandates declared uncertainty bounds, methodology, and forecast horizons ($\le 72\text{ hours}$). Explicitly labeled as *Advisory Alert*, not physical reduction.
3. **`INTERVENTION_COMPLETION`**:
   - **Evidence Requirement**: Requires a verifiable physical action manifest, dispatch log (e.g. baler routing record), or verifier attestation with completion timestamps.
4. **`QUANTIFIED_EMISSIONS_REDUCTION`**:
   - **Evidence Requirement**: Requires empirical measurement plus a declared baseline methodology (e.g. EPA Subpart W or Nature Comms 2026 counterfactuals); the code only checks that a methodology field exists and does not validate it or apply uncertainty deductions.
   - **Model-to-Carbon Prohibition**: Strictly rejects model extrapolations or simulated carbon cuts (`MODEL_CANNOT_PROVE_EMISSIONS_REDUCTION`).

### Key Algorithmic Innovations
- **Composite Scope Exclusivity**:
  Computes a composite key $\text{scopeKey} = \text{SHA-256}(\text{canonicalJson}(\text{domain}, \text{boundary label}, \text{period}, \text{activityType}))$, and flags reused evidence digests. It does not compute geographic or polygon overlap and cannot see other registries or chains.
  - Detects duplicate claims attempting to evade detection via newly minted claim IDs.
  - Critically, **allows legitimate co-located distinct activities** (e.g. straw baling collection vs. solar pump installation on the same grid cell) without false rejection.
- **Explicit UNKNOWN & HUMAN_REVIEW_REQUIRED States**:
  When evidence is missing or contradictory, the system halts deterministic approval and assigns `UNKNOWN` or `HUMAN_REVIEW_REQUIRED` with explicit remediation steps.
- **Hash-addressed Firewall Verification Receipts**:
  Generates a hash-addressed `FirewallReceipt` (unsigned JSON plus its canonical SHA-256 hash). Only claims receiving an `ACCEPTED` verdict are marked eligible for on-chain anchoring.

---

## 2. Platform Architecture & Integration Contributions

In addition to the Trust Firewall, the Climate Chain team authored:
1. **The 5-Stage Mission Architecture (`Sense → Verify → Act → Finance → Prove`)**:
   A unified data pipeline connecting disparate environmental verticals (air quality, methane plumes, agricultural residue burning, municipal waste, and forest conservation) without fabricating combined causal totals.
2. **Deterministic Hardhat EVM Contracts**:
   - `EvidenceAnchor.sol`: Prevents duplicate anchoring of manifest SHA-256 digests.
   - `EnvironmentalEvidenceRegistry.sol`: Enforces role-based attestation with append-only parent-child lineage inside a resettable local development chain (Hardhat/EDR, chain ID 31337, valueless ETH, reset on restart or when the demo ledger fills; not a public or immutable ledger).
   - `ClimateClaimRegistry.sol`: Enforces scope-level exclusivity, challenge adjudication, and zero speculative tokenomics.
3. **Framework-free Node.js Gateway (3 runtime dependencies)**:
   Gateway unit tests (run npm test for current counts), Windows DPAPI (Windows; env key elsewhere) / AES-256-GCM memory encryption, and live API adapters for four civic services (DumpWatch, AshAlert, TapAlert, AirPulse) with explicit `LIVE` vs `SIMULATED` labeling.
4. **Interactive Command Center & Cesium Satellite Globe**:
   Vitest tests (run npm test for current counts), 0 ESLint warnings, 32 distinct views, interactive browser-based SHA-256 recomputation matching EVM contract storage, and terminal curl reproduction.

---

## 3. Strict Boundary on Third-Party Code

We explicitly acknowledge that 18 native modules are re-implemented in climate-chain/frontend/src/modules from the source projects and run on bundled fixtures (8 SIMULATED, 6 RESEARCH, 4 DEMO); the original project folders are not included in this repository. All third-party metrics (such as MethaneMend's 10,098 Carbon Mapper CH₄ plumes, reported upstream; this repository ships a 60-plume sample, ImpactGraph's FalkorDB property graph, and CarbonScope's Random Forest classifier) are accurately attributed to their respective authors in [`docs/COMPONENT_PROVENANCE_AND_ATTRIBUTION.md`](COMPONENT_PROVENANCE_AND_ATTRIBUTION.md). We do not claim to have authored those external projects.
