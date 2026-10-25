# Third-Party Provenance, Licensing & Attribution Directory

**IEEE ClimateChain Global Hackathon 2026**  
*Provenance self-review: October 24, 2026*

---

## 1. Attribution Statement

For clarity and in line with the Hackathon Rules:
- **No Claim of Authorship Over Third-Party Projects**: The Climate Chain team does not claim sole authorship of the 18 specialist repositories integrated into this unified platform. Each project was created by its respective authors for specific hackathons, research labs, or open-source initiatives.
- **Clear Attribution of Datasets & Benchmarks**: All third-party benchmarks (such as Swinfield et al. Nature Communications REDD+ datasets, Carbon Mapper Permian Basin CH₄ measurements, or VIIRS nightfire data) are formally credited to their original publishing organizations.
- **Original Contributions Maintained**: Climate Chain's novel engineering is the **Evidence-to-Claim Trust Firewall**, the **5-Step Mission Architecture (`Sense → Verify → Act → Finance → Prove`)**, the **Local EVM Environmental Smart Contracts**, the **Framework-free Resilient Gateway (3 runtime dependencies)**, and the **Creamy-White Unified Operational Platform**.

---

## 2. Comprehensive Third-Party Project Inventory

*18 native modules are re-implemented in climate-chain/frontend/src/modules from the source projects and run on bundled fixtures (8 SIMULATED, 6 RESEARCH, 4 DEMO). The original project folders are not included in this repository; paths and `/apps/...` routes below describe the original projects.*

| Module Identifier | Canonical Path | Original Creator / Maintainers | License | Original Purpose / Domain | Integration Method in Climate Chain |
|---|---|---|---|---|---|
| **AquaQuest** | `projects/AquaQuest-main` | Luzayna Rahman | MIT License | Citizen-science freshwater PWA and testing toolkit | Unified route at `/apps/aquaquest/`, citizen sensor intake bridge |
| **CarbonTrace** | `projects/CarbonTrace-main` | CarbonTrace Contributors | MIT License | Satellite-verified land-cell retirement and spatial forest claims | Land parcel audit engine, spatial retirement verification |
| **ClimateProof AI** | `projects/ClimateProof-AI-main` | ClimateProof AI Team | MIT License | Environmental CSV schema validator and statistical outlier detector | Tabular dataset ingest validation in Evidence Registry |
| **JunkSnap** | `projects/JunkSnap-main` | Hemang and contributors | GNU AGPL-3.0 | Waste evidence to municipal civic action (Jodhpur, Rajasthan) | Live Gateway adapter (`/api/v1/overview`), privacy blur inspection |
| **PLUME** | `projects/PLUME-main` | Kaavinb and contributors | Apache License 2.0 | High-emission methane plume detection and DBSCAN clustering | Permian Basin CH₄ snapshot (10,098 plumes reported by upstream PLUME; this repo ships a 60-plume sample) & EIP-712 verifier specs (upstream only) |
| **CarbonLens** | `projects/carbonlens-main` | Krishna | MIT License | Sentinel-2 Random Forest forest cover classifier & Olofsson bias correction | Preview web app at `/apps/carbonlens/`, forest baseline calculator |
| **CarbonShield** | `projects/carbonshield-main` | Quantify Earth / Swinfield et al. | Research / Open Data (Zenodo 15745712) | REDD+ over-crediting red-teaming based on *Nature Communications (2026)* | Counterfactual baseline auditor and additionality screening |
| **CarbonTwin** | `projects/carbontwin-main` | Hyunsik Parker | MIT License | Cross-registry double-issuance matching (ACR, CAR, VCS) | Double-issuance screening engine at `/apps/carbontwin/` |
| **ClearSky** | `projects/clearsky-main` | Team Atherion | Source-Available Open License | Farm stubble burning prevention and baler logistics (Punjab) | Live Gateway adapter for district fire radar and baler routes |
| **EcoGraph** | `projects/ecograph-main` | EcoGraph Contributors | MIT License | FalkorDB OpenCypher graph reasoning & MCP tools for credit cycling | Graph intelligence story view at `/apps/ecograph/` |
| **Flarewatch** | `projects/flarewatch-main` | Flarewatch Contributors | MIT License | VIIRS satellite gas flaring detection across the Niger Delta | Satellite flaring monitor at `/apps/flarewatch/` |
| **GridProof** | `projects/gridproof-main` | GridProof Contributors | MIT License | Hourly clean energy matching and device-hour verification | 24/7 clean energy certificate validation logic |
| **Grounded** | `projects/grounded-main` | Anshuman (codewithanshuman) | Source-Available Open License | 72-hour microgrid resilience simulation and dispatch decision-support | Microgrid lab simulator in Energy Trading track |
| **HourMatch** | `projects/hourmatch-master` | Hua-I Yu | MIT License | Granular hourly clean power certificate accounting | Interactive matching console at `/apps/hourmatch/` |
| **PlotLock** | `projects/plotlock-main` | Ratnesh Saxena | MIT License | Stubble plot attestation and boundary verification on Polygon Amoy | Land boundary attestation module at `/apps/plotlock/` |
| **Rantai 3C** | `projects/rantai-3c-master` | Akhmad Khudri | MIT License | Supply chain carbon emissions accounting and marketplace | Corporate Scope 3 ledger view |
| **Teesri Shikayat** | `projects/teesri-shikayat-main` | Aryan Gorde | MIT License | Neighborhood water contamination tripwire (Mumbai) | Live Gateway adapter for water tripwires and 72-hour alert rings |
| **The Vayu Project** | `projects/the-vayu-project-main` | The Vayu Project Team | MIT License | Ground monitor air quality aggregator (Delhi & NCR) | Live Gateway adapter for real-time station metrics & coordinate query |

---

## 3. Scientific Benchmark & Dataset Citations

### 1. REDD+ Over-Crediting Benchmark (CarbonShield)
- **Primary Literature**: Swinfield, T., et al. (2026). *"Learning lessons from over-crediting to ensure additionality in forest carbon credits"*, **Nature Communications**, 17, Article 2145. DOI: `10.1038/s41467-026-71552-3`.
- **Dataset Repository**: Zenodo Open Archive. DOI: `10.5281/zenodo.15745712`.
- **Usage**: Cited as the methodological reference for the CarbonShield research module.

### 2. Methane Plume Observations (PLUME)
- **Primary Source**: Carbon Mapper Airborne / Satellite Public Instrument Observations (Permian Basin Flight Campaigns 2020–2024).
- **Snapshot File**: `PLUME-main/data/snapshots/carbonmapper_permian_ch4.json.gz`.
- **Record Count**: 10,098 observations reported by upstream PLUME (not stored in this repository, which ships a 60-plume sample) with geographic bounding boxes, estimated flux rates (kg/hr), and observation timestamps.

### 3. Satellite Flaring Nightfire (Flarewatch)
- **Instrument**: NOAA / NASA Suomi NPP VIIRS (Visible Infrared Imaging Radiometer Suite) Nightfire (VNF).
- **Geographic Bounding**: Niger Delta petroleum extraction flares (fixtures in this repository cover Oct 15–20, 2026: 6 days, 675 detections).
- **Processing**: Temperature threshold filtering (>1600 K) and radiant heat estimation (MW).

### 4. Continuous Ground Air Quality (The Vayu Project)
- **Primary Source**: Central Pollution Control Board (CPCB) of India via OpenAQ & National Ambient Air Quality Index (NAAQI).
- **Coverage**: Continuous monitoring stations across Delhi, Gurugram, Noida, and Faridabad.

---

## 4. Upstream Dependency Licenses

The unified platform depends on well-established open-source libraries:
- **React 19 & React DOM**: MIT License (Meta Platforms, Inc.)
- **Vite & Rollup**: MIT License (Evan You and Vite Contributors)
- **Hardhat & Ethers.js**: MIT License (Nomic Foundation, Richard Moore)
- **CesiumJS**: Apache License 2.0 (Cesium GS, Inc.)
- **Lucide Icons**: ISC License (Lucide Contributors)
- **Vitest**: MIT License (Vitest Team)

License compatibility has not been legally reviewed (for example, JunkSnap is AGPL-3.0 and ClearSky / Grounded are Source-Available).
