# Migration Inventory: Comprehensive Workspace Audit

**IEEE ClimateChain Global Hackathon 2026**  
*Audited: October 24, 2026 | Environment: Windows / Node.js 22 LTS / Hardhat EVM*

---

## 1. Executive Summary

This inventory documents every directory, file type, dependency manifest, smart contract, machine learning pipeline, dataset, and configuration file across the `IEEE CLIMATE CHAIN` workspace.

### Core Discovery Findings
1. **Repository Topology**:
   - The workspace root `IEEE CLIMATE CHAIN/` contained the primary application repository (`climate-chain/`) alongside 18 separately extracted competitor/specialist project folders.
   - All 18 specialist project folders were previously integrated into `climate-chain/projects/`.
   - A cryptographic byte-level audit across all 18 folders confirmed that **every active source file, test, contract, and dataset in `climate-chain/projects/` is an exact hash match with the root folders**, while the root folders retained ephemeral build artifacts (`.venv`, `.next`, `__pycache__`, `.pytest_cache`, `.mypy_cache`, `.ruff_cache`).
2. **Canonical Application Stack**:
   - **Frontend**: React 19 + TypeScript + Vite (`climate-chain/frontend`), 510 passing Vitest tests, 32 distinct views, Cesium 3D Earth, Climate Integrity Lab.
   - **Backend Gateway**: Zero-dependency Node.js (`climate-chain/gateway`), 173 passing unit tests, Windows DPAPI / AES-256-GCM memory vault, Trust Firewall policy engine.
   - **Blockchain**: Local Hardhat EVM (`climate-chain/blockchain`), 19 unit tests, `EvidenceAnchor.sol`, `EnvironmentalEvidenceRegistry.sol`, `ClimateClaimRegistry.sol`.
   - **Registry**: `projects.json` (18 projects across 4 IEEE tracks), `features.json` (canonical cross-cutting capability map).

---

## 2. Directory & Component Classification

| Directory / Path | Classification | Authoritative Status | Action in Consolidation |
|---|---|---|---|
| `climate-chain/frontend/` | **ORIGINAL CORE** | Authoritative UI | Canonical Frontend. Re-themed to creamy white palette. |
| `climate-chain/gateway/` | **ORIGINAL CORE** | Authoritative API | Canonical Backend Gateway. Exposes civic connectors & Trust Firewall. |
| `climate-chain/blockchain/` | **ORIGINAL CORE** | Authoritative EVM | Canonical Smart Contracts. Deploys on local chain ID 31337. |
| `climate-chain/registry/` | **ORIGINAL CORE** | Authoritative Catalog | Canonical IEEE Track & capability registry (`projects.json`, `features.json`). |
| `climate-chain/projects/` | **UNIFIED MODULES** | Authoritative Modules | Canonical location for all 18 specialist modules and datasets. |
| `AquaQuest-main/` (root) | Duplicate | Ephemeral copy | Safely archived; active canonical copy in `projects/AquaQuest-main`. |
| `CarbonTrace-main/` (root) | Duplicate | Ephemeral copy | Safely archived; active canonical copy in `projects/CarbonTrace-main`. |
| `ClimateProof-AI-main/` (root) | Duplicate | Ephemeral copy | Safely archived; active canonical copy in `projects/ClimateProof-AI-main`. |
| `JunkSnap-main/` (root) | Duplicate + Cache | Contains 64 `.pyc` | Safely archived; active canonical copy in `projects/JunkSnap-main`. |
| `PLUME-main/` (root) | Duplicate + Cache | Contains `.next` build | Safely archived; active canonical copy in `projects/PLUME-main`. |
| `carbonlens-main/` (root) | Duplicate | Missing index.html | Safely archived; authoritative copy in `projects/carbonlens-main`. |
| `carbonshield-main/` (root) | Duplicate + Cache | Contains 10,705 `.venv` | Safely archived; active canonical copy in `projects/carbonshield-main`. |
| `carbontwin-main/` (root) | Duplicate + Cache | Contains 8 `.pyc` | Safely archived; active canonical copy in `projects/carbontwin-main`. |
| `clearsky-main/` (root) | Duplicate + Cache | Contains `.tsbuildinfo` | Safely archived; active canonical copy in `projects/clearsky-main`. |
| `ecograph-main/` (root) | Duplicate + Cache | Contains 14 `.pytest` | Safely archived; active canonical copy in `projects/ecograph-main`. |
| `flarewatch-main/` (root) | Duplicate | Ephemeral copy | Safely archived; active canonical copy in `projects/flarewatch-main`. |
| `gridproof-main/` (root) | Duplicate | Ephemeral copy | Safely archived; active canonical copy in `projects/gridproof-main`. |
| `grounded-main/` (root) | Duplicate | Ephemeral copy | Safely archived; active canonical copy in `projects/grounded-main`. |
| `hourmatch-master/` (root) | Duplicate | Ephemeral copy | Safely archived; active canonical copy in `projects/hourmatch-master`. |
| `plotlock-main/` (root) | Duplicate | Ephemeral copy | Safely archived; active canonical copy in `projects/plotlock-main`. |
| `rantai-3c-master/` (root) | Duplicate + Cache | Contains `.tsbuildinfo` | Safely archived; active canonical copy in `projects/rantai-3c-master`. |
| `teesri-shikayat-main/` (root) | Duplicate + Cache | Contains 2,367 `.mypy` | Safely archived; active canonical copy in `projects/teesri-shikayat-main`. |
| `the-vayu-project-main/` (root) | Duplicate | Ephemeral copy | Safely archived; active canonical copy in `projects/the-vayu-project-main`. |

---

## 3. Dataset & Empirical Evidence Inventory

Every dataset in the workspace has been inventoried and verified against its authentic source:

1. **Carbon Mapper Methane Plumes** (`PLUME-main/data/snapshots/carbonmapper_permian_ch4.json.gz`):
   - 10,098 real historical plume records over the Permian Basin (TX/NM). Size: 3.18 MB compressed.
2. **CarbonTwin Candidate Pairs** (`carbontwin-main/data/candidates.json`):
   - ACR, CAR, and VCS duplicate credit screening candidates. Size: ~31 MB.
3. **Flarewatch Satellite Detections** (`frontend/src/modules/flarewatch/fixtures/`):
   - Daily VIIRS nightfire gas flaring observations over the Niger Delta (Oct 15–19, 2026).
4. **Vayu Air Quality Readings** (`the-vayu-project-main/data/`):
   - Delhi & NCR ground monitor records and coordinate models.
5. **JunkSnap Civic Waste Reports** (`JunkSnap-main/backend/data/`):
   - 121 verified reports across 44 waste locations in Jodhpur/Rajasthan.
6. **CarbonShield Nature Communications (2026) Benchmarks** (`carbonshield-main/data/`):
   - REDD+ baseline and counterfactual over-crediting tables (Zenodo 15745712).
