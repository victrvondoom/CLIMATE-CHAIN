# Module capability and integration matrix

The matrix distinguishes source capability from central integration. “Shared now” means the feature is represented in Climate Chain's current API/UI; a project link alone is not an integration.

| Folder | Preserve | API / integration seam | Current central status | Main risk / next safe adapter |
|---|---|---|---|---|
| climate-chain | Four-source overview, per-source live/mock label, 3D overview, mission/capability library | Node gateway; /api/unified/overview and /api/v1/cascade | **Partially implemented**; new read-only waste-to-air proximity workflow locally verified | No shared persistence/auth; do not add unauthenticated writes; keep source evidence references and no-causality label |
| JunkSnap | Public site GeoJSON, report timestamps, quorum verification, privacy blur, ward mapping, cited letters | GET /sites?bbox=... and GET /sites/{id}; native write routes require source auth/ownership | **Partially integrated**; public sites feed overview and cascade | AGPL-3.0; use only public DTOs; never centralize reporter identity, raw media or writes |
| clearsky | Burn-risk scoring, straw/baler/buyer matching, village alert workflow | Public /api/stats and /api/impact; fields/villages/alerts role-protected | **Partially integrated** as regional counters only | Demo/seed data can mix with live rows; require explicit source mode and synthetic composition before deeper integration |
| teesri-shikayat | 3-home / 250 m / 72 h tripwire, approval, resident closure | GET /api/state snapshot; demo actions are guarded | **Partially integrated**; current snapshot normalized | Privacy risk in home-level state; needs redacted, versioned incident DTO before storage |
| the-vayu-project | Monitor provenance, timestamp/age, air timeline, hardware and exposure UI | Read-only /v1/today, /v1/timeline, /v1/stations, /v1/fires | **Partially integrated**; Today is used; Cascade queries a selected public site | Preserve station/model/replay modes; exact monitor coordinates are not in Today; do not label model as observed |
| carbonlens | Forest classification, bias correction, reversal checks, serial registry | Local pipeline outputs and contract demo | **Not API-integrated; simulated** | Sentinel-2-like scenes and project cases are demo; preserve algorithm version and assumptions if read-only adapter is added |
| carbonshield | Baseline/leakage/measurement/carbon-stock sensitivity analysis | Read-only FastAPI over precomputed research outputs | **Not integrated; research** | License unresolved; keep unsupported dimensions and artifact provenance explicit |
| carbontwin | Cross-registry candidate match, human-readable model adjudication, Merkle findings | Static findings JSON; local EVM contract harness | **Not integrated; demo candidates** | Preserve source listings, pair evidence, model version and “possible match” language; do not auto-freeze/issue |
| ecograph | Graph-pattern review and human decision interface | Read-only MCP tools plus demo decision endpoints | **Not integrated; synthetic sandbox** | Planted ledger only; decision API mutates demo graph; never point at a real registry |
| PLUME | Real historical Carbon Mapper observations, clustering, source-aware evidence | Read-only /api/v1 data routes; separate repair/funding writes | **Not integrated; best next read-only adapter candidate** | Historical observations, repair simulation and contract state must remain separate; retain attribution and snapshot time |
| grounded | 72-hour dispatch, battery constraints, policy search, holdout validation | Independent Fastify APIs, WebSocket, SQLite; POSTs create simulations | **Not integrated; research tool** | No root license; NSW reference profiles are not Jaipur telemetry; explicit user action and scenario labels required |
| AquaQuest | Offline PWA, guided observation, education and community contribution patterns | No server API; static frontend uses LocalStorage | **Not integrated; prototype** | Bangladesh demo data and local mock submissions cannot be treated as live; no prototype auth/data reuse |
| rantai-3c | Carbon analysis UI, governance/marketplace experiment, contracts | Next API routes and wallet integration; Pinata upload via env key after fix | **Not integrated; demo** | Some chain/price/marketplace fallbacks are simulated; failed writes now throw; rotate prior Pinata credentials |

## Duplicate and reusable concepts

| Shared concept | Folders | Safe shared abstraction |
|---|---|---|
| Carbon-credit integrity | carbonlens, carbonshield, carbontwin, ecograph | A findings envelope with source, candidate/assessment status, evidence references, model/version and reviewer decision; do not flatten into a single fraud score |
| Smart contracts | PLUME, carbonlens, carbontwin, rantai-3c | Network/chain metadata, transaction status and verifier/contract attribution; never synthesize a transaction hash |
| Satellite/remote sensing | PLUME, carbonlens, clearsky, Vayu, grounded | Provider, acquisition time, processing time, dataset/license, spatial coverage, mode and uncertainty |
| Citizen reports | AquaQuest, JunkSnap, Teesri | Consent, source ID, observation time, location precision, moderation state and private/public access tier |
| Maps | AquaQuest, JunkSnap, PLUME, clearsky, EcoGraph, Vayu, Climate Chain, Rantai | Layer contract with feature geometry, source mode, as-of time and privacy policy |
| Language and chat channels | clearsky, Teesri, Vayu, JunkSnap | Channel-neutral intake metadata while retaining each channel's native consent, identity and policy |

## Integration order

1. Finish hardening and validating the four existing civic adapters. Teesri and clearsky need redacted/provenance-aware DTOs before broad central use.
2. Expand the Vayu-JunkSnap cascade only with source-backed event timestamps, monitor provenance and privacy checks; keep all decisions human-owned.
3. Add PLUME as a separate read-only historical observation adapter using its versioned API.
4. Import CarbonTwin candidate findings and CarbonShield research sensitivity only as attributed read-only evidence after licensing/data terms are checked.
5. Keep CarbonLens and EcoGraph in labeled demo/sandbox spaces unless their data is replaced with licensed real inputs.
6. Add Grounded, AquaQuest and Rantai via explicit user handoffs or import/export contracts; do not attach their local/demo stores to a shared production identity.
