# Component Provenance, Attribution, and License Inventory

**IEEE ClimateChain Global Hackathon 2026**  
*Audit Completed: 24 October 2026*

---

## 1. Audit and Attribution Correction Statement

An earlier draft of our project benchmarks inadvertently conflated metrics from external research projects with the folders in this workspace. In accordance with IEEE academic and engineering integrity standards, this document formally corrects all attributions and establishes the verified provenance of every folder, model, and dataset in the repository.

### Key Corrections
1. **EcoGraph (`ecograph-main`)**:
   - *Previous incorrect attribution*: Attributed 492 tests and Isolation Forest anomaly detection to EcoGraph.
   - *Actual provenance*: EcoGraph was developed by the **EcoGraph contributors** for the WeMakeDevs x FalkorDB Graph Hacks (MIT License, Copyright © 2026). It implements an OpenCypher graph in FalkorDB with 11 MCP tools for detecting double-retirements and trading cycles. The 492 tests and Isolation Forest metrics belonged to an external project (**Rastro**) and have been removed from EcoGraph's documentation.
2. **CarbonLens & CarbonShield (`carbonlens-main`, `carbonshield-main`)**:
   - *Previous incorrect attribution*: Attributed a 177-question AI evaluation benchmark to CarbonLens/CarbonShield.
   - *Actual provenance*: The 177-question benchmark was from an external evaluation (**OnceSealed**). In our repository:
     - **CarbonLens** (MIT License, Copyright © 2026 Krishna) is a Python Random Forest model for Sentinel-2 forest cover classification with bias correction (Olofsson et al., 2014) and on-chain report hashes.
     - **CarbonShield** is a scientific red-teaming framework based on **Swinfield et al. (2026), Nature Communications** (*"Learning lessons from over-crediting to ensure additionality in forest carbon credits"*, DOI: 10.1038/s41467-026-71552-3; Data DOI: 10.5281/zenodo.15745712).
3. **ClearSky (`clearsky-main`)**:
   - *Previous incorrect attribution*: Attributed a 0.89 IoU fire perimeter segmentation and 0.97 ROC-AUC to ClearSky.
   - *Actual provenance*: Those metrics belonged to an external satellite vision project (**ReGrow**). ClearSky is an original logistics platform by **Team Atherion** (WeMakeDevs x AWS Environmental Hacks, Oct 2026) featuring WhatsApp-first farmer intake (Hindi/Punjabi), crop-residue management (CRM) baler routing, and district-level Burn Risk Radar.
4. **PLUME (`PLUME-main`)**:
   - *Actual provenance*: Developed by **Kaavinb and contributors** (Apache 2.0 License). It contains a real snapshot of 10,098 methane plume observations from the **Carbon Mapper public API** over the Permian Basin, a DBSCAN clustering pipeline, and EIP-712 verifier escrow. This is specialist third-party work included in our workspace as an integrated capability, not authored by the central ClimateChain hub.

---

## 2. Complete Component Classification

Every component in this repository is classified under one of four rigorous categories:
- **ORIGINAL**: Authored specifically for the Climate Chain central platform during this hackathon.
- **MODIFIED THIRD-PARTY**: Existing open-source/hackathon software modified or adapted with new connectors, normalizers, or UI bridges.
- **UNMODIFIED THIRD-PARTY**: Existing projects merged into `climate-chain/projects/` and workspace root, preserving original code and licenses.
- **REFERENCE ONLY**: Datasets, papers, standards, or external benchmarks cited for methodology.

| Component / Folder | Classification | Primary Authors / Maintainers | License | What Runs in Climate Chain |
|---|---|---|---|---|
| `climate-chain/gateway` | **ORIGINAL** | Climate Chain Team | MIT / Hackathon | Central zero-dependency Node.js gateway (166 passing tests), multi-source normalizers, Windows DPAPI / AES-256-GCM memory vault, Trust Firewall, durable DAG execution engine. |
| `climate-chain/blockchain` | **ORIGINAL** | Climate Chain Team | MIT / Hackathon | Hardhat EVM contracts: `EvidenceAnchor.sol`, `EnvironmentalEvidenceRegistry.sol`, `ClimateClaimRegistry.sol` (19 passing unit tests). |
| `climate-chain/frontend` | **ORIGINAL** | Climate Chain Team | MIT / Hackathon | React 19 + TypeScript + Vite command center, Cesium Earth satellite globe, Climate Integrity Lab, Evidence-to-Claim Trust Firewall UI, 32-view dashboard (510 passing vitest tests). |
| `climate-chain/registry` | **ORIGINAL** | Climate Chain Team | MIT / Hackathon | Normalized IEEE track registry (`projects.json`), canonical cross-project capability catalog (`features.json`). |
| `JunkSnap-main` | **MODIFIED THIRD-PARTY** | Hemang and contributors | GNU AGPL-3.0 | Live API adapter in gateway (`/api/v1/overview`), proxy routes, privacy blur inspection, and read-only Waste-to-Air Cascade Review. |
| `clearsky-main` | **MODIFIED THIRD-PARTY** | Team Atherion | Source available | Live API adapter for season counters and straw booking stats, fire signal screen, farmer payout calculations. |
| `teesri-shikayat-main` | **MODIFIED THIRD-PARTY** | Aryan Gorde | MIT | Live API adapter for water tripwire status and neighborhood warning-ring aggregates. |
| `the-vayu-project-main` | **MODIFIED THIRD-PARTY** | The Vayu Project contributors | MIT | Live API adapter for Delhi & NCR ground air stations, coordinate queries, and provenance validation. |
| `AquaQuest-main` | **UNMODIFIED THIRD-PARTY** | Luzayna Rahman | MIT | Static citizen-science freshwater PWA served at `/apps/aquaquest/`. |
| `PLUME-main` | **UNMODIFIED THIRD-PARTY** | Kaavinb and contributors | Apache-2.0 | Historical Carbon Mapper Permian Basin CH₄ snapshot (10,098 plumes), DBSCAN module, EIP-712 contract specs. |
| `carbonlens-main` | **UNMODIFIED THIRD-PARTY** | Krishna | MIT | Random Forest Sentinel-2 forest classifier, reversal change detection, standalone dashboard served at `/apps/carbonlens/`. |
| `carbonshield-main` | **UNMODIFIED THIRD-PARTY** | Quantify Earth / Nature Comms | Research / Open Data | REDD+ red-team auditing framework based on Swinfield et al. (Nature Comms 2026), Zenodo dataset 15745712. |
| `carbontwin-main` | **UNMODIFIED THIRD-PARTY** | Hyunsik Parker | MIT | Cross-registry double-issuance matching, Merkle verification, served at `/apps/carbontwin/`. |
| `ecograph-main` | **UNMODIFIED THIRD-PARTY** | EcoGraph contributors | MIT | FalkorDB OpenCypher graph reasoning, MCP tools, story page served at `/apps/ecograph/`. |
| `grounded-main` | **UNMODIFIED THIRD-PARTY** | Anshuman (codewithanshuman) | Source available | 72-hour microgrid resilience simulation and dispatch decision-support lab. |
| `rantai-3c-master` | **UNMODIFIED THIRD-PARTY** | Akhmad Khudri | MIT | Web3 carbon management and marketplace prototype on Ethereum Sepolia. |
| `CarbonTrace-main` | **UNMODIFIED THIRD-PARTY** | CarbonTrace contributors | MIT | Spatial land-cell retirement checks, satellite-verified forest claims. |
| `ClimateProof-AI-main` | **UNMODIFIED THIRD-PARTY** | ClimateProof AI contributors | MIT | Environmental CSV schema validation and statistical outlier detection. |
| `flarewatch-main` | **UNMODIFIED THIRD-PARTY** | Flarewatch contributors | MIT | Niger Delta gas flaring monitor, NASA VIIRS pipeline, Solana devnet anchor. Served at `/apps/flarewatch/`. |
| `gridproof-main` | **UNMODIFIED THIRD-PARTY** | GridProof contributors | MIT | Hourly renewable certificate generator and device-hour verification. |
| `hourmatch-master` | **UNMODIFIED THIRD-PARTY** | Hua-I Yu | MIT | Hourly clean power certificate accounting and claim checker. Served at `/apps/hourmatch/`. |
| `plotlock-main` | **UNMODIFIED THIRD-PARTY** | Ratnesh Saxena | MIT | Stubble plot attestation on Polygon Amoy testnet. Served at `/apps/plotlock/`. |

---

## 3. What is Original to Climate Chain

The original contribution of Climate Chain is **not** claiming to have trained 18 separate domain models from scratch. Rather, it is the creation of:

1. **The Evidence-to-Claim Trust Firewall**: A deterministic, rule-based verification policy engine that prevents greenwashing, double-claiming, and unverified emissions reductions by evaluating claim types against strict evidence tiers.
2. **The 5-Step Mission Architecture (`Sense → Verify → Act → Finance → Prove`)**: Unifying heterogeneous environmental signals (air, water, fire, waste, forest, energy) without fabricating combined totals.
3. **Cross-Domain Integrity Contracts**: Deploying and testing Solidity smart contracts (`EvidenceAnchor.sol`, `EnvironmentalEvidenceRegistry.sol`, `ClimateClaimRegistry.sol`) on a local EVM with zero speculative tokenomics.
4. **Zero-Dependency Production Gateway**: Aggregating four live civic APIs in real-time with strict fallback labeling (`LIVE` vs `SIMULATED`), authenticated AES-256-GCM memory encryption, and local DAG worker execution.
5. **Interactive Climate Integrity Lab & Cesium Earth Workspace**: Real-time browser-based SHA-256 recomputation matching EVM contract storage, tamper testing, and independent terminal auditability.
