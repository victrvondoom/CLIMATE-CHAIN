# Component Provenance, Attribution, and License Inventory

**IEEE ClimateChain Global Hackathon 2026**  
*Self-review completed: 24 October 2026*

---

## 1. Audit and Attribution Correction Statement

An earlier draft of our project benchmarks inadvertently conflated metrics from external research projects with the folders in this workspace. This document corrects those attributions and records the provenance, as understood by the project authors, of every source project, model, and dataset referenced. 18 native modules are re-implemented in climate-chain/frontend/src/modules from the source projects and run on bundled fixtures (8 SIMULATED, 6 RESEARCH, 4 DEMO). The original project folders are not included in this repository; the folder names below refer to the original source projects.

### Key Corrections
1. **ImpactGraph (`ecograph-main`)**:
   - *Previous incorrect attribution*: Attributed 492 tests and Isolation Forest anomaly detection to ImpactGraph.
   - *Actual provenance*: ImpactGraph was developed by the **ImpactGraph contributors** for the WeMakeDevs x FalkorDB Graph Hacks (MIT License, Copyright © 2026). It implements an OpenCypher graph in FalkorDB with 11 MCP tools for detecting double-retirements and trading cycles. The 492 tests and Isolation Forest metrics belonged to an external project (**Rastro**) and have been removed from ImpactGraph's documentation.
2. **CarbonScope & SinkGuard (`carbonlens-main`, `carbonshield-main`)**:
   - *Previous incorrect attribution*: Attributed a 177-question AI evaluation benchmark to CarbonLens/CarbonShield.
   - *Actual provenance*: The 177-question benchmark was from an external evaluation (**OnceSealed**). In our repository:
     - **CarbonScope** (MIT License, Copyright © 2026 Krishna) is a Python Random Forest model for Sentinel-2 forest cover classification with bias correction (Olofsson et al., 2014) and on-chain report hashes.
     - **SinkGuard** is a scientific red-teaming framework based on **Swinfield et al. (2026), Nature Communications** (*"Learning lessons from over-crediting to ensure additionality in forest carbon credits"*, DOI: 10.1038/s41467-026-71552-3; Data DOI: 10.5281/zenodo.15745712).
3. **AshAlert (`clearsky-main`)**:
   - *Previous incorrect attribution*: Attributed a 0.89 IoU fire perimeter segmentation and 0.97 ROC-AUC to AshAlert.
   - *Actual provenance*: Those metrics belonged to an external satellite vision project (**ReGrow**). AshAlert is an original logistics platform by **Team Atherion** (WeMakeDevs x AWS Environmental Hacks, Oct 2026) featuring WhatsApp-first farmer intake (Hindi/Punjabi), crop-residue management (CRM) baler routing, and district-level Burn Risk Radar.
4. **MethaneMend (`PLUME-main`)**:
   - *Actual provenance*: Developed by **Kaavinb and contributors** (Apache 2.0 License). Upstream it contains a snapshot of 10,098 methane plume observations from the **Carbon Mapper public API** over the Permian Basin (this repository ships a 60-plume sample), a DBSCAN clustering pipeline, and EIP-712 verifier escrow specs (upstream only; not executed here). This is specialist third-party work included in our workspace as an integrated capability, not authored by the central ClimateChain hub.

---

## 2. Complete Component Classification

Every component referenced is classified under one of four categories:
- **ORIGINAL**: Authored specifically for the Climate Chain central platform during this hackathon.
- **MODIFIED THIRD-PARTY**: Existing open-source/hackathon software modified or adapted with new connectors, normalizers, or UI bridges.
- **UNMODIFIED THIRD-PARTY**: Existing upstream projects that are not modified by Climate Chain. Their original folders are not included in this repository (the local `climate-chain/projects/` folder is gitignored); Climate Chain ships native re-implementations on bundled fixtures instead.
- **REFERENCE ONLY**: Datasets, papers, standards, or external benchmarks cited for methodology.

| Component / Folder | Classification | Primary Authors / Maintainers | License | What Runs in Climate Chain |
|---|---|---|---|---|
| `climate-chain/gateway` | **ORIGINAL** | Climate Chain Team | MIT / Hackathon | Central framework-free Node.js gateway (3 runtime dependencies; run npm test for current counts), multi-source normalizers, Windows DPAPI (Windows; env key elsewhere) / AES-256-GCM memory vault, Trust Firewall, durable DAG execution engine. |
| `climate-chain/blockchain` | **ORIGINAL** | Climate Chain Team | MIT / Hackathon | Hardhat EVM contracts: `EvidenceAnchor.sol`, `EnvironmentalEvidenceRegistry.sol`, `ClimateClaimRegistry.sol` (unit-tested; run npm test for current counts). |
| `climate-chain/frontend` | **ORIGINAL** | Climate Chain Team | MIT / Hackathon | React 19 + TypeScript + Vite command center, Cesium Earth satellite globe, Climate Integrity Lab, Evidence-to-Claim Trust Firewall UI, 32-view dashboard (vitest tests; run npm test for current counts). |
| `climate-chain/registry` | **ORIGINAL** | Climate Chain Team | MIT / Hackathon | Normalized IEEE track registry (`projects.json`), canonical cross-project capability catalog (`features.json`). |
| `JunkSnap-main` | **MODIFIED THIRD-PARTY** | Hemang and contributors | GNU AGPL-3.0 | Live API adapter in gateway (`/api/v1/overview`), proxy routes, privacy blur inspection, and read-only Waste-to-Air Cascade Review. |
| `clearsky-main` | **MODIFIED THIRD-PARTY** | Team Atherion | Source available | Live API adapter for season counters and straw booking stats, fire signal screen, farmer payout calculations. |
| `teesri-shikayat-main` | **MODIFIED THIRD-PARTY** | Aryan Gorde | MIT | Live API adapter for water tripwire status and neighborhood warning-ring aggregates. |
| `the-vayu-project-main` | **MODIFIED THIRD-PARTY** | AirPulse contributors | MIT | Live API adapter for Delhi & NCR ground air stations, coordinate queries, and provenance validation. |
| `AquaQuest-main` | **UNMODIFIED THIRD-PARTY** | Luzayna Rahman | MIT | Static citizen-science freshwater PWA served at `/apps/aquaquest/`. |
| `PLUME-main` | **UNMODIFIED THIRD-PARTY** | Kaavinb and contributors | Apache-2.0 | Upstream: historical Carbon Mapper Permian Basin CH₄ snapshot (10,098 plumes; this repo ships a 60-plume sample), DBSCAN module, EIP-712 contract specs (not executed here). |
| `carbonlens-main` | **UNMODIFIED THIRD-PARTY** | Krishna | MIT | Random Forest Sentinel-2 forest classifier, reversal change detection, standalone dashboard served at `/apps/carbonlens/`. |
| `carbonshield-main` | **UNMODIFIED THIRD-PARTY** | Quantify Earth / Nature Comms | Research / Open Data | REDD+ red-team auditing framework based on Swinfield et al. (Nature Comms 2026), Zenodo dataset 15745712. |
| `carbontwin-main` | **UNMODIFIED THIRD-PARTY** | Hyunsik Parker | MIT | Cross-registry double-issuance matching, Merkle verification, served at `/apps/carbontwin/`. |
| `ecograph-main` | **UNMODIFIED THIRD-PARTY** | ImpactGraph contributors | MIT | FalkorDB OpenCypher graph reasoning, MCP tools, story page served at `/apps/ecograph/`. |
| `grounded-main` | **UNMODIFIED THIRD-PARTY** | Anshuman (codewithanshuman) | Source available | 72-hour microgrid resilience simulation and dispatch decision-support lab. |
| `rantai-3c-master` | **UNMODIFIED THIRD-PARTY** | Akhmad Khudri | MIT | Web3 carbon management and marketplace prototype on Ethereum Sepolia. |
| `CarbonTrace-main` | **UNMODIFIED THIRD-PARTY** | TonneTrail contributors | MIT | Spatial land-cell retirement checks, satellite-verified forest claims. |
| `ClimateProof-AI-main` | **UNMODIFIED THIRD-PARTY** | ClaimGuard AI contributors | MIT | Environmental CSV schema validation and statistical outlier detection. |
| `flarewatch-main` | **UNMODIFIED THIRD-PARTY** | TorchSight contributors | MIT | Niger Delta gas flaring monitor, NASA VIIRS pipeline, Solana devnet anchor. Served at `/apps/flarewatch/`. |
| `gridproof-main` | **UNMODIFIED THIRD-PARTY** | WattCert contributors | MIT | Hourly renewable certificate generator and device-hour verification. |
| `hourmatch-master` | **UNMODIFIED THIRD-PARTY** | Hua-I Yu | MIT | Hourly clean power certificate accounting and claim checker. Served at `/apps/hourmatch/`. |
| `plotlock-main` | **UNMODIFIED THIRD-PARTY** | Ratnesh Saxena | MIT | Stubble plot attestation on Polygon Amoy testnet. Served at `/apps/plotlock/`. |

---

## 3. What is Original to Climate Chain

The original contribution of Climate Chain is **not** claiming to have trained 18 separate domain models from scratch. Rather, it is the creation of:

1. **The Evidence-to-Claim Trust Firewall**: A deterministic, rule-based verification policy engine that flags greenwashing, duplicate claims within this registry, and unsupported emissions reductions by evaluating claim types against evidence tiers (advisory).
2. **The 5-Step Mission Architecture (`Sense → Verify → Act → Finance → Prove`)**: Unifying heterogeneous environmental signals (air, water, fire, waste, forest, energy) without fabricating combined totals.
3. **Cross-Domain Integrity Contracts**: Deploying and testing Solidity smart contracts (`EvidenceAnchor.sol`, `EnvironmentalEvidenceRegistry.sol`, `ClimateClaimRegistry.sol`) on a local EVM with zero speculative tokenomics.
4. **Framework-free Node.js Gateway (3 runtime dependencies)**: Aggregating four live civic APIs with fallback labeling (`LIVE` vs `SIMULATED`), authenticated AES-256-GCM memory encryption, and local DAG worker execution.
5. **Interactive Climate Integrity Lab & Cesium Earth Workspace**: Real-time browser-based SHA-256 recomputation matching EVM contract storage, tamper testing, and independent terminal auditability.
