# IEEE Climate Chain — Unified Platform & Historical Climate Intelligence

**Global Climate Chain Platform — Multi-Track Climate Intelligence, Evidence Ledger, and Trust Firewall**  
*Built for the IEEE ClimateChain Global Hackathon 2026. Hackathon submission; not certified, audited or endorsed by IEEE or any third party.*

---

## 1. Product Purpose & Original Contribution

Climate Chain is an end-to-end, multi-track climate platform covering all four IEEE hackathon tracks. 18 native modules are re-implemented in climate-chain/frontend/src/modules from the source projects and run on bundled fixtures (8 SIMULATED, 6 RESEARCH, 4 DEMO). The original project folders are not included in this repository. Tracks:
1. **Carbon Markets & Emissions Transparency**
2. **Renewable Energy & Energy Trading**
3. **Sustainable Supply Chains**
4. **Climate Data & Environmental Monitoring**

### What is Original to Climate Chain
We do not claim to have trained 18 separate domain models from scratch or invented new climate laws. Rather, Climate Chain introduces six foundational engineering breakthroughs:

1. **The Evidence-to-Claim Trust Firewall**: A deterministic, rule-based verification policy engine that evaluates environmental claims against four evidence tiers with deterministic rules. It strictly enforces:
   - *Model-to-Observation Prohibition*: Modelled forecasts and simulated estimates are barred from masquerading as verified real-world observations.
   - *Model-to-Carbon Prohibition*: Simulated reductions are rejected by the Model-to-Carbon rule; no tokenization exists in this build.
   - *Cryptographic Tamper & Collision Detection*: Duplicate protection compares a SHA-256 of {domain, boundary label, period, activity} and reused evidence digests, within this registry only. It does not compute geographic or polygon overlap and cannot see other registries or chains.
   - *Synthetic Regression Suite*: 55 author-written synthetic regression cases (scripts/generate-adversarial-fixtures.mjs). The firewall scores 27 TP / 28 TN / 0 FP / 0 FN (F1 1.00) on this suite by construction. This is a regression check, not an external accuracy or security evaluation. Latency is about 0.1 ms per claim on the author's machine.
2. **The 5-Step Mission Architecture (`Sense → Verify → Act → Finance → Prove`)**: Unifying heterogeneous environmental signals (waste, stubble fire, water contamination, air pollution, methane leaks, grid power) without fabricating combined totals.
3. **Local EVM Environmental Evidence Ledger**: Three unit-tested Solidity contracts (19 Hardhat tests; no external audit) (`EvidenceAnchor.sol`, `EnvironmentalEvidenceRegistry.sol`, `ClimateClaimRegistry.sol`) on a local development EVM (Chain ID 31337) with zero speculative tokenomics. Local development EVM (Hardhat/EDR, chain ID 31337, valueless ETH, reset on restart or when the demo ledger fills). Anchoring shows the recorded bytes were committed to this chain. It is not a public or immutable ledger and does not show a measurement is true.
4. **Climate Intelligence Timeline (200 Years of Environmental Evidence)**: Explorer of 108 hand-keyed reference values (1832-2026); interpolated years are linear and labelled INTERPOLATED; years before the first record are shown as gaps. Sources cited: NOAA NCEI, NASA GISS, CSIRO/AAD Law Dome ice cores, Mauna Loa Keeling Curve, IRENA.
5. **Framework-free Node.js Gateway (3 runtime dependencies) & Creamy-White Workspace**: A resilient Node.js gateway managing live civic adapters with automatic fallback labeling (`LIVE` vs `SIMULATED`), authenticated Windows DPAPI (Windows; env key elsewhere) / AES-256-GCM memory encryption, and a modern, high-contrast creamy-white user interface (`#F5F3EE` / `#FFFEFA` / `#F0EDE6`) with full light and dark themes.
6. **The Data Refinery — a tool that makes scientific research faster**: Research is full of avoidable delays — cleaning and reformatting data, digging through papers by hand, re-running the same analysis over and over, or waiting on a workflow that should be automated. Climate Chain picks one bottleneck and removes it: the Data Refinery turns messy agency CSV/JSON exports into analysis-ready data in seconds, entirely in the browser (see Section 5d).

---

## 2. Platform Architecture & Repository Structure

The entire platform is organized as a single canonical root:

```
IEEE CLIMATE CHAIN/
|-- .env                      # Canonical runtime environment variables
|-- .env.example              # Documented environment template
|-- .gitignore                # Version control exclusions
|-- package.json              # Top-level workspace script runner
|-- start.ps1                 # Single supported entrypoint launcher
|-- README.md                 # Authoritative platform documentation
|
|-- climate-chain/
|   |-- frontend/             # React 19 + TypeScript + Vite Creamy-White Command Center (run npm test for current counts)
|   |-- gateway/              # Framework-free Node.js API Gateway & Trust Firewall (3 runtime dependencies; run npm test for current counts)
|   |-- blockchain/           # Hardhat EVM smart contracts & test suite (run npm test for current counts)
|   |-- registry/             # Canonical registries (projects.json, features.json, datasets.json)
|   |-- projects/             # Optional local-only folder (gitignored); the 18 native modules are re-implemented in frontend/src/modules on bundled fixtures (8 SIMULATED, 6 RESEARCH, 4 DEMO); original project folders are not included in this repository
|
|-- data/
|   |-- manifests/            # Reversible archival and SHA-256 evidence manifests
|
|-- docs/                     # Full engineering reports, audits, and scientific benchmarks
|   |-- MIGRATION_INVENTORY.md
|   |-- DEDUPLICATION_REPORT.md
|   |-- THIRD_PARTY_PROVENANCE.md
|   |-- TRUST_FIREWALL_BENCHMARK_REPORT.md
|   |-- SCIENTIFIC_EVIDENCE_BENCHMARKS.md
|
|-- .archive/                 # Non-destructive, reversible archive of original raw clones (local only, not committed)
```

---

## 3. Installation & Prerequisites

- **Operating System**: Windows 10/11, macOS, or Linux.
- **Node.js**: Node.js 22 LTS or newer (tested on Node.js v24.14.0 with system CA support).
- **Package Manager**: npm 10+ (bundled with Node.js).

### Setup in 2 Commands
From the workspace root (`IEEE CLIMATE CHAIN`):

```powershell
# 1. Install dependencies across all platform subsystems
npm run test:blockchain
npm run test:gateway
npm run test:frontend

# 2. Build production assets
npm run build
```

---

## 4. Environment Configuration (`.env`)

The platform uses **exactly ONE canonical root `.env`**. No secret credentials or private keys are ever committed. Safe local development defaults are pre-configured:

```ini
# Gateway Port & Host
PORT=8080
CLIMATE_CHAIN_PORT=8080
HOST=127.0.0.1

# Local Hardhat Proof-Chain (Loopback RPC, Chain ID 31337)
CLIMATE_CHAIN_RPC_URL=http://127.0.0.1:18545
EVM_RPC_URL=http://127.0.0.1:18545
CHAIN_ID=31337

# Frontend Configuration
VITE_API_BASE=http://127.0.0.1:8080
VITE_CESIUM_ION_TOKEN=

# Live Civic Connectors
JUNKSNAP_API_URL=https://junksnap.coehemang.dev
CLEARSKY_API_URL=https://clearsky.akkki.tech
TEESRI_SHIKAYAT_API_URL=https://eirioqqhvtvve3aw5xhpje2wju0jztrl.lambda-url.ap-south-1.on.aws
VAYU_API_URL=https://vayu.thevayuproject.org
PLUME_API_URL=https://plume.kaavin.dev
```

---

## 5. Single Supported Startup Entrypoint

To start the local EVM node, deploy the smart contracts, and launch the unified production gateway and frontend in one command:

```powershell
.\start.ps1
```

Once running, access the platform at:
👉 **`http://127.0.0.1:8080`**

To stop, simply press `Ctrl + C` in the PowerShell terminal; child EVM processes and workers terminate cleanly.

---

## 5a. Agent & Response Layer

Optional: `gateway/live-data-mcp.mjs` exposes three read-only MCP tools to external coding agents. The gateway itself calls no LLM.

- **Provenance is preserved**: Every value the MCP tools return keeps its `LIVE` or `SIMULATED` label and its source.
- **No model verifies claims**: Acceptance of an environmental claim is decided only by the deterministic Evidence-to-Claim Trust Firewall (Section 7).
- **Agent memory**: Agent context is stored in the encrypted local memory store (Windows DPAPI on Windows; env key elsewhere / AES-256-GCM).

---

## 5b. Global Pollution Atlas (195 countries, no API key)

Sidebar → **Global Pollution Atlas**. A globe with one AQI-coloured marker per country (sampled at its capital), a ranking table, and a click-anywhere inspector.

- **Click a marker or any spot on the globe** to see US AQI, PM2.5 / PM10 / NO₂ / O₃ / SO₂ / CO, how many times PM2.5 exceeds the WHO 24-hour guideline (15 µg/m³), and **how much of the surrounding area is polluted**.
- **Polluted area** is the share of a 5 × 5 grid of model cells (about 200 × 220 km) around the picked point that is above US AQI 100, with the cell grid drawn as a mini-map.
- **Data**: Copernicus CAMS atmospheric model via the keyless [Open-Meteo Air Quality API](https://open-meteo.com/en/docs/air-quality-api). Routes: `GET /api/v1/world/air/countries` (195 points, five batched upstream calls, cached 1 h) and `GET /api/v1/world/air/point?lat=&lng=`.
- **Labelled MODELLED, never observed.** The model is about 40 km resolution outside Europe, so a street-level monitor can differ. A capital stands in for its country. Countries with no model value are left out of rankings instead of being shown as clean. Model values above the top of the AQI scale (500) display as "500+".

---

## 5c. Blockchain features on serverless hosts (Vercel)

A serverless function cannot keep a blockchain node alive, so on Vercel the gateway runs its own **in-process EVM** (Hardhat's EDR engine, chain ID 31337) and rebuilds it on demand. Locally and on Render nothing changes: the launcher's Hardhat node is still used unless `CLIMATE_CHAIN_CHAIN=in-process` is set.

- **Replayable ledger.** Every mined transaction is appended to a hash-linked journal of *signed raw transactions* plus the block timestamp used (`GET /api/v1/chain/journal`). A cold instance replays the journal onto a fresh engine with a fixed genesis and reproduces identical blocks, receipts and contract state. The journal is tamper-evident: each entry commits to the previous one, and each transaction carries its sender's signature.
- **Shared across instances.** The journal and the off-chain evidence store live in a **private Vercel Blob** store (`BLOB_READ_WRITE_TOKEN`). Each journal slot is created with create-if-absent, so when two instances race, exactly one wins; the other rolls back, replays what it missed and retries, or reports a clear `409` if part of a multi-step operation had already been sent. Without a Blob token it falls back to files (single instance only).
- **Strong keys.** The attester, claimant, reviewer and challenger accounts are derived from a secret seed (`CLIMATE_CHAIN_SIGNER_SEED`, 32+ characters; HMAC-SHA256 per role), so they are not Hardhat's published development keys. Transactions are signed locally; the engine never exposes unlocked accounts, and `evm_*`, `hardhat_*`, `debug_*`, `personal_*` and unsigned-send methods are blocked. A hosted deployment without a seed refuses to start the chain rather than guess one.
- **Independent verification.** `POST /api/v1/chain/rpc` is a read-only JSON-RPC allowlist (`eth_call`, `eth_getLogs`, receipts, blocks…), so the browser's "verify independently" step can check the chain without trusting the gateway's own summaries.
- **Public writes are bounded.** A hosted deployment accepts anchoring from its own pages only (same-origin), rate-limited per address. The local launcher still accepts writes from loopback only.
- **Limits.** Capacity is 200 journal entries by default; when full, the demo chain starts a fresh epoch (history is not retained). Local development EVM (Hardhat/EDR, chain ID 31337, valueless ETH, reset on restart or when the demo ledger fills). Anchoring shows the recorded bytes were committed to this chain. It is not a public or immutable ledger and does not show a measurement is true.
- **Contracts.** `blockchain/scripts/export-artifacts.js` writes `gateway/chain-artifacts.json` (ABI, bytecode and a hash of each `.sol`); a gateway test fails if the committed file is stale.

---

## 5d. Data Refinery — a tool that makes scientific research faster

Research is full of avoidable delays: cleaning and reformatting data, digging through papers by hand, re-running the same analysis over and over, or waiting on a workflow that should be automated. **The Data Refinery removes the first and most common of these bottlenecks** — the hours researchers lose normalizing heterogeneous climate exports (NOAA, OpenAQ, CPCB, field sensors) before any analysis can start.

Paste any CSV (comma, semicolon or tab) or JSON array into the Refinery (sidebar → *Research Tools → Data Refinery*) and it deterministically produces an analysis-ready dataset:

- **Timestamp normalization to ISO 8601**, including `MM/DD/YYYY` vs `DD/MM/YYYY` detection, two-digit years, and merging separate date + time columns.
- **Unit harmonization** for common climate parameters: temperature (°F/K → °C), pressure (kPa/atm/inHg/mmHg → hPa), gases (ppb/ppt → µg/m³ at 25 °C, WHO factors), particulates (ng/m³ or mg/m³ → µg/m³), wind (km/h/mph/knots → m/s), precipitation (inches → mm).
- **Canonical column names** (`timestamp`, `temperature_c`, `pm25_ugm3`, `no2_ugm3`, `wind_ms`, …) while leaving unrecognized columns untouched.
- **Duplicate removal** for identical rows; conflicting rows that share a timestamp are *flagged*, never silently dropped.
- **Missing-value handling**: `NA`/`null`/blank tokens are normalized and counted; interior numeric gaps are linearly interpolated and reported — edge gaps stay missing because inventing data there would be speculation.
- **Outlier flagging with IQR (1.5×)**: suspicious values (e.g. a PM2.5 sensor fault of 9999) are flagged for review, not deleted.
- **Per-column summary statistics** (count, missing, outliers, mean, min, max) and a downloadable cleaned CSV with a **SHA-256 digest** for provenance.

Everything runs locally in the browser — no data leaves the machine, no API key required. The cleaning engine is a pure TypeScript module (`climate-chain/frontend/src/modules/refinery/refinery.ts`) covered by 12 unit tests, so the same transformations can be reused headlessly in scripts.

---

## 6. Climate Datasets & 200-Year Provenance Catalog

Registry of 8 reference datasets. This repository embeds 108 hand-keyed anchor values (35 temperature, 30 CO2, 27 CH4, 16 renewable share); other annual values are linearly interpolated and labelled INTERPOLATED. Record counts and checksums describe upstream files that are not stored here. Catalogue: [`climate-chain/registry/datasets.json`](climate-chain/registry/datasets.json):

| Dataset Identifier | Variable | Official Agency & Source | Records upstream (not stored here) | Temporal Span | Data Classification |
|---|---|---|---|:---:|---|
| `noaa-ghcn-gistemp-v4` | Surface Temp Anomaly (°C) | NOAA NCEI / NASA GISS | 1,761 | 1880–2026 | Hand-keyed reference values (interpolated where marked) |
| `law-dome-noaa-co2-combined` | Atmospheric CO₂ (ppm) | CSIRO/AAD Law Dome & NOAA Mauna Loa | 195 | 1832–2026 | Hand-keyed reference values (interpolated where marked) |
| `law-dome-noaa-ch4-combined` | Atmospheric CH₄ (ppb) | CSIRO/AAD Law Dome & NOAA GML | 186 | 1841–2026 | Hand-keyed reference values (interpolated where marked) |
| `permian-carbonmapper-ch4-plumes` | CH₄ Plume Flux (kg/hr) | Carbon Mapper / NASA JPL AVIRIS | 10,098 (60-plume sample shipped) | 2020–2024 | Calibrated Remote Sensing |
| `cpcb-india-naaqi-stations` | PM2.5 & AQI (μg/m³) | Central Pollution Control Board (CPCB), India | 83,940 (none stored here) | 2015–2026 | Observed Station Data |
| `irena-global-renewable-share` | Renewable Generation (%) | IRENA / Energy Institute | 62 | 1965–2026 | Hand-keyed reference values (interpolated where marked) |
| `redd-nature-comms-swinfield` | Deforestation Counterfactuals | Swinfield et al., Nature Comms (2026) | 1,240 (none stored here) | 2008–2024 | Research Benchmark (Zenodo) |
| `viirs-nightfire-niger-delta` | Flaring Radiant Heat (MW) | NOAA EOG / NASA VIIRS | 18,250 (675 detections over 6 days stored here) | 2020–2026 | Calibrated Satellite Pass |

### Hourly dataset stored here: 91,872 city-hours

`climate-chain/data/climate-hourly/` holds **91,872 hourly rows** for six cities (Delhi, Chennai, Jodhpur, Chandigarh, Midland TX, Port Harcourt; 2024-11-01 to 2026-07-31), served at `GET /api/v1/history/hourly`. The `cams_*` columns (PM2.5, PM10, NO2, SO2, O3, CO, CH4, CO2) are **modelled** Copernicus CAMS output and the `era5_*` columns are ECMWF ERA5 **reanalysis**, both via Open-Meteo under CC BY 4.0 (non-commercial free tier). They are **not station observations** and are never labelled as measured. The manifest records SHA-256 hashes of the data and of every upstream response; rebuild with `node climate-chain/gateway/scripts/fetch-climate-hourly.mjs`. Public-domain measured series from NOAA GML and NASA GISS are stored alongside for provenance.

### Critical Scientific Principle: Real Data Gaps
- **Global Temperature**: Instrument coverage prior to 1880 was insufficient for a calibrated global mean. Years before the first record are shown as gaps.
- **Renewable Electricity**: International fuel-by-fuel grid statistics were formalized in 1965. Prior years are marked as an explicit gap.
- **Gaps and interpolation**: Gaps are shown; interpolated years are linear and flagged in the API; uncertainty appears as +/- in the evidence card, not as a band.

---

## 7. Evidence-to-Claim Trust Firewall & Benchmarks

The **Evidence-to-Claim Trust Firewall** (`climate-chain/gateway/trust-firewall.mjs`) is an original deterministic verification engine applying eight policy rules across four claim tiers:

```
[ Incoming Environmental Claim ]
              ↓
  CANONICAL_HASH_INTEGRITY
  SOURCE_PROVENANCE_AUTHENTICITY
  EVIDENCE_BASIS_COMPATIBILITY
  TEMPORAL_CONSISTENCY_AND_FRESHNESS
  GEOGRAPHIC_SCOPE_CONSISTENCY
  DUPLICATE_SCOPE_EXCLUSIVITY
  CONTRADICTORY_EVIDENCE_RECONCILIATION
  UNCERTAINTY_AND_SUFFICIENCY_BOUNDING
              ↓
[ ACCEPTED (flagged eligible for anchoring) ] or [ Rejected with Audit Trace ]
```

ACCEPTED claims are flagged eligible for anchoring; the firewall does not block claim submission (unless the optional enforcement gate is enabled).

### 55-Case Synthetic Regression Suite
55 author-written synthetic regression cases (scripts/generate-adversarial-fixtures.mjs) covering 5 sites and these categories: valid (x4 tiers), tamper, model-as-observation, model-as-carbon, stale, new-ID duplicate, co-located distinct, broken custody, contradictory. The firewall scores 27 TP / 28 TN / 0 FP / 0 FN (F1 1.00) on this suite by construction. This is a regression check, not an external accuracy or security evaluation. Latency is about 0.1 ms per claim on the author's machine.

### v2: does the evidence support *this* claim? (not only: was the data hashed)

Hashing proves the bytes did not change; it does not prove the evidence supports the claim. v2 adds, on top of the eight rules:

- **Claim-type-aware sufficiency profiles** (`claim-sufficiency.mjs`): `methane-response` (observed baseline and post-repair emission rates, a completed repair with measurements on the right side of it, an independent verifier, and a claimed tCO2e that cannot exceed the measured rate drop over the time that has actually passed), `livestock-traceability` (unbroken custody, a registry cross-check, no animal reused across claims) and `air-quality` (the claimed analyte, unit and value must match the evidence). Unknown claim types and profiles fail closed.
- **Overlap-safe exclusivity:** the same activity class at the same place over an intersecting period is a duplicate even when the boundary label, period granularity or wording differs, and re-wrapped evidence is caught by normalised content fingerprints. Duplicate checks read the registry; if it cannot be read completely the claim is refused rather than accepted.
- **Statistical plausibility** (`plausibility.mjs`): a quantile envelope fitted to 91,872 real city-hours. It sends unusual values to a human and never rejects.
- **Opt-in enforcement gate** (`CLIMATE_CHAIN_FIREWALL_ENFORCE=1`): claim submission and correction are refused with HTTP 409 unless the firewall accepts them. Off by default.
- **Never throws:** malformed or hostile claims and evidence are rejected with a reason.

Evaluation, stated plainly: the **v2 adversarial suite** has 39 scored synthetic cases (plus 2 documented known limitations) written after probing v1's blind spots, and the runner checks the verdict *and* the rule that fired (`node benchmark-runner.mjs --v2`: 39/39). It is a targeted regression and threat-model suite, not a blind test. The **plausibility envelope** was evaluated on 22,032 real held-out hours (train 2024-11 to 2026-02, test 2026-03 to 2026-07): 0.24% false alarms; synthetic PM2.5 spikes of x10 are caught 96% of the time, x3 43%, x1.5 8%.

**What it cannot do** (see [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md)): it cannot tell that a self-consistent, correctly hashed bundle was invented, and it cannot see claims in other registries. Both are demonstrated as expected-accepted cases in the suite. Receipts are unsigned and the chain is a local development chain.

Reproduce everything:

```
cd climate-chain/gateway
node --test tests/*.test.mjs && node benchmark-runner.mjs --v2
node scripts/evaluate-plausibility.mjs
node scripts/demo-trust-firewall.mjs   # live Open-Meteo source -> rejected and accepted claims -> local-chain receipts
```

---

## 8. Smart Contracts on Local EVM

Deployed on local Hardhat EVM (RPC: `http://127.0.0.1:18545`, Chain ID: `31337`). Local development EVM (Hardhat/EDR, chain ID 31337, valueless ETH, reset on restart or when the demo ledger fills). Anchoring shows the recorded bytes were committed to this chain. It is not a public or immutable ledger and does not show a measurement is true.
- `EvidenceAnchor.sol`: Gas-efficient SHA-256 manifest commitment with collision prevention.
- `EnvironmentalEvidenceRegistry.sol`: Append-only evidence lifecycle registry linking corrections to parent records.
- `ClimateClaimRegistry.sol`: Locked geographic-temporal scope claiming, community challenge mechanisms, and unconflicted adjudication. Zero token minting surface.

---

## 9. Specialist Modules Across the 4 IEEE Tracks

18 native modules are re-implemented in climate-chain/frontend/src/modules from the source projects and run on bundled fixtures (8 SIMULATED, 6 RESEARCH, 4 DEMO). The original project folders are not included in this repository. Source projects:
- **Carbon Markets**: SinkGuard (REDD+ additionality), CarbonScope (Sentinel-2 biomass), UniqueCredit (double-issuance Merkle screening), ImpactGraph (FalkorDB credit loops), TonneTrail (spatial parcel retirements).
- **Renewable Energy**: HourSync (24/7 clean power matching), WattCert (device-hour certificates), Resilia (72-hour microgrid resilience lab).
- **Sustainable Supply Chains**: AshAlert (Punjab stubble fire prevention & baler routing), DumpWatch (civic waste-to-action), SupplyTrail (corporate Scope 3 ledger).
- **Environmental Monitoring**: AirPulse (Delhi continuous air quality), TapAlert (water contamination tripwires), MethaneMend (Permian Basin CH₄ plumes), TorchSight (VIIRS satellite gas flaring), BlueTrail (citizen freshwater science), ClaimGuard AI (dataset schema anomaly validator), ParcelSeal (stubble plot attestations).

---

## 10. Automated Test Results & Reproducibility

Execute all automated test suites directly from the repository root:

```powershell
npm test
```

### Test Summary
Counts change as tests are added; run `npm test` for current counts for the smart contracts (`blockchain`), the gateway (`gateway`; the live chain e2e test may be skipped) and the frontend (`frontend`), plus ESLint and the Vite build.

---

## 11. Third-Party Provenance & Academic Citations

- **REDD+ Benchmark**: Swinfield, T., et al. (2026). *"Learning lessons from over-crediting to ensure additionality in forest carbon credits"*, **Nature Communications**, 17, 2145. DOI: `10.1038/s41467-026-71552-3` (Zenodo: `10.5281/zenodo.15745712`).
- **Methane Observations**: Carbon Mapper / NASA JPL Permian Basin airborne campaign (10,098 plumes reported upstream; this repository ships a 60-plume sample).
- **Surface Temperature**: NOAA NCEI / NASA GISS GISTEMP v4 (Lenssen et al., 2019).
- **Atmospheric CO₂ & CH₄**: CSIRO / Australian Antarctic Division Law Dome Ice Cores (Etheridge et al., 1996; MacFarling Meure et al., 2006) and NOAA Global Monitoring Laboratory (Tans & Keeling, 2026).
- Complete attribution directory: [`docs/THIRD_PARTY_PROVENANCE.md`](../docs/THIRD_PARTY_PROVENANCE.md).

---

## 12. Hackathon Demo Instructions (5-Minute Tour)

1. Launch the platform: `.\start.ps1`.
2. Open `http://localhost:8080` in your browser.
3. **Command Center**: View real-time civic feeds from Delhi (Air), Punjab (Fire), Mumbai (Water), and Jodhpur (Waste). Notice clear `LIVE` vs `SIMULATED` fallback indicators.
4. **200-Year Timeline**: Navigate to `200-Year Timeline` in the sidebar. Drag the slider to 1850 to observe the explicit historical data gap. Jump to 1970 to observe the Clean Air Act milestone and 2024 to inspect the NOAA temperature anomaly evidence manifest.
5. **Climate Integrity Lab**: Click `Climate Integrity Lab` in the sidebar. Run the **Trust Firewall Adversarial Benchmark** (55 test cases) to see 100% precision (synthetic regression suite) and sub-millisecond execution. Test Step 6 & 7 to anchor an evidence receipt to the local EVM.
