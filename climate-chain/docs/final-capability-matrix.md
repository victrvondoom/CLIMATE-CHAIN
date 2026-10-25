# IEEE Climate Chain 2026: capability and route audit

Audited on 2026-10-23 against the running local app at `http://127.0.0.1:8080`. The dashboard has 14 core views and 18 native modules. All 32 hash destinations opened in the browser and rendered their expected page heading/content without a route-level error or HTTP 5xx during the route sweep.

“Verified working” means the named workflow was exercised and returned the expected result in this local run. “Working with limitations” means the route and bounded behavior work, with the limits in the row. A working page is not evidence that a source project is production-connected. “Simulated / demonstration only” means its data or workflow is explicitly a fixture, sample, or research demonstration.

## Core workspace

| Destination | Status | What was verified | Limits and provenance | Route |
|---|---|---|---|---|
| Command center | **VERIFIED WORKING** | Live status cards, workspace navigation, refresh/retry, and dashboard layout rendered. The four shared upstreams reported `LIVE` at 2026-10-23 14:37 UTC. | Upstream status is a point-in-time snapshot. Unavailable sources use visibly labeled fallback data. | `/#overview` |
| Satellite climate globe | **WORKING WITH LIMITATIONS** | Cesium Earth rendered with imagery, place selection, sunlight and camera controls. Pause held the simulation time; 3600× advanced the model clock about an hour per second; 1× returned to real-time progression. Clicking the globe changed the selected coordinate and solar readout. | Solar geometry uses NOAA’s approximate equations for the Sun’s centre and UTC time; it does not model local terrain or atmospheric refraction. Air/weather values are model products, mapped infrastructure is not measured production or emissions, and imagery dates vary. | `/#earth` |
| Waste · DumpWatch | **WORKING WITH LIMITATIONS** | Live source snapshot loaded from DumpWatch, with public site coordinates and status. | Read-only shared adapter; no household data and no specialist-project clearance action is performed here. | `/#waste` |
| Fire · AshAlert | **WORKING WITH LIMITATIONS** | Live aggregate source snapshot loaded. | Aggregate counters are not a geospatial fire observation; the module’s risk/action walkthrough remains simulated. | `/#fire` |
| Water · TapAlert | **WORKING WITH LIMITATIONS** | Live, anonymized aggregate source state loaded. | No household records are exposed; the module’s incident workflow is simulated and does not submit to the specialist service. | `/#water` |
| Air · AirPulse | **WORKING WITH LIMITATIONS** | Live AirPulse response loaded for the shared overview. | Response provenance can be model rather than monitor-observed; OpenAQ is not configured, so a station comparison is unavailable. | `/#air` |
| Guided mission path | **WORKING WITH LIMITATIONS** | Focus and mission-stage navigation rendered with project handoffs. | Recommendations guide a person to the project that owns an action; they do not execute that action or assign causality. | `/#mission` |
| Unified mission studio | **WORKING WITH LIMITATIONS** | Mission composition and local durable mission controls rendered in the four-panel check. | Planning/dry-run output is simulated. Bounded worker tasks use local state, readiness gates and human approvals; they do not operate specialist systems. | `/#studio` |
| Place-based review · Climate Cascade | **WORKING WITH LIMITATIONS** | Live DumpWatch and AirPulse requests returned HTTP 200. The actual result was `source_not_observed`, `candidate: false`, and evidence coverage `0/3`; missing observed-monitor evidence remained explicit. | The current AirPulse value was model provenance; the older DumpWatch report was outside the selected time window. No candidate or causal finding was created. | `/#cascade` |
| Climate Integrity Lab | **VERIFIED WORKING · LOCAL EVM** | Live-only Chennai PM10 CAMS fetch, browser and gateway digest checks, chain read-back, tamper rejection, replay rejection, duplicate claim rejection, challenge and correction all completed through the UI. | CAMS is a model forecast for an approximately 45 km grid, not a monitor reading. Claims are demonstration records, not certified credits. | `/#integrity` |
| Review desk | **WORKING WITH LIMITATIONS** | Review queue and local review controls rendered and remained usable. | Review decisions are local to this workspace; they do not approve or close records in a source project. | `/#session` |
| Evidence ledger | **VERIFIED WORKING · LOCAL EVM** | Cascade manifest transaction was written and read back as verified on chain 31337. Integrity Lab independently verified its evidence digest directly against the local RPC. | The local Hardhat chain resets on launcher restart; these records are not public or durable across restarts. | `/#ledger` |
| All capabilities | **WORKING WITH LIMITATIONS** | Registry-backed library lists the 18 merged projects and their handoff/readiness notes. | A listed feature or external link is not a claim of live integration. See the native-module rows below. | `/#capabilities` |
| AI engineering memory | **WORKING WITH LIMITATIONS** | Local vault reports `READY`; 6 direct/UI reads returned HTTP 200 after fixing DPAPI output parsing. | The vault is local and empty in this run: 0 active judgments. MCP must be installed in each external coding agent for agent-side recall. | `/#memory` |

## Native modules

Each module route was included in the 32-route browser sweep. “Open” here confirms the route is reachable inside Climate Chain; it does not imply the original project’s hosted app, backend, wallet, or authentication is being used.

| Native module | Status | What the module currently does | Route |
|---|---|---|---|
| DumpWatch | **WORKING WITH LIMITATIONS** | Presents the shared live waste snapshot and local evidence affordances. | `/#module:junksnap` |
| AshAlert | **WORKING WITH LIMITATIONS** | Reads shared live aggregate inputs; its risk/action scenario is explicitly simulated. | `/#module:clearsky` |
| TapAlert | **WORKING WITH LIMITATIONS** | Uses shared aggregate water state; household incident handling remains a simulated walkthrough. | `/#module:teesri` |
| AirPulse | **WORKING WITH LIMITATIONS** | Reads the shared live air response with source mode/provenance labels. | `/#module:vayu` |
| BlueTrail | **SIMULATED / DEMONSTRATION ONLY** | Uses the project’s walkthrough/sample content. | `/#module:aquaquest` |
| ClaimGuard AI | **WORKING WITH LIMITATIONS** | Accepts a user-provided local dataset; the included sample is marked simulated. | `/#module:climateproof` |
| CarbonScope | **SIMULATED / DEMONSTRATION ONLY** | Presents a local research/demo dashboard; no production credit registry is connected. | `/#module:carbonlens` |
| SinkGuard | **WORKING WITH LIMITATIONS** | Runs a local research audit on bundled or user-imported tabular data. | `/#module:carbonshield` |
| UniqueCredit | **SIMULATED / DEMONSTRATION ONLY** | Demonstrates a Merkle inclusion check against bundled research records; it is not externally anchored. | `/#module:carbontwin` |
| HourSync | **SIMULATED / DEMONSTRATION ONLY** | Demonstrates hourly matching using demo records; no certificate registry is connected here. | `/#module:hourmatch` |
| ParcelSeal | **SIMULATED / DEMONSTRATION ONLY** | Displays the research/demo land-claim flow; this route does not make a live testnet transaction. | `/#module:plotlock` |
| rantai 3C | **SIMULATED / DEMONSTRATION ONLY** | Shows simulated energy, NFT and payment examples; it does not call a wallet, chain, or PayPal. | `/#module:rantai` |
| ImpactGraph | **SIMULATED / DEMONSTRATION ONLY** | Uses bundled demo ledger content. | `/#module:ecograph` |
| grounded | **SIMULATED / DEMONSTRATION ONLY** | Runs a local dispatch simulation with stated assumptions. | `/#module:grounded` |
| TonneTrail | **SIMULATED / DEMONSTRATION ONLY** | Uses bundled scenario and evidence fixtures. | `/#module:carbontrace` |
| MethaneMend | **WORKING WITH LIMITATIONS** | Presents a research workflow with historical detections and a simulated repair/funding path. | `/#module:plume` |
| TorchSight | **WORKING WITH LIMITATIONS** | Presents a research interface; it is not a live hotspot response service in this workspace. | `/#module:flarewatch` |
| WattCert | **SIMULATED / DEMONSTRATION ONLY** | Uses synthetic hourly meter series for its demo checks. | `/#module:gridproof` |

## On-chain proof from this run

The blockchain use is scoped to evidence integrity: Climate Chain commits a digest of the exact review/evidence bytes so a later copy can be checked against a recorded local-chain event. The source payload remains off-chain. The chain proves the digest was recorded and matches those bytes; it cannot prove the environmental measurement is true, observed, caused by a given site, or beneficial.

| Workflow | Result observed in the UI | Local-chain evidence |
|---|---|---|
| Cascade manifest | The actual live manifest represented `source_not_observed`, `candidate: false`, and 0% coverage. That outcome was preserved without turning it into a review candidate. | `EvidenceAnchor`, chain 31337, block 27; transaction `0xf31a890cccce8dbf3222800f3d6c21eb689583e788d7a1d65cef7caa3632a1b7`; digest `0x8420988c5d527f67252b1d0b49db6da30f2d3bed2a63da01645bf6a711f5eb20`; direct gateway lookup returned `proofVerified: true`. |
| Chennai PM10 evidence | Live-only Open-Meteo CAMS model packet; independent browser and gateway verification passed. Changing one value from 6.6 to 6.7 produced a different digest and failed verification. | `EnvironmentalEvidenceRegistry`, chain 31337, block 20; receipt status 1; transaction `0xe1cc3b498e48d2807f3c14d8caf2f8792a8d9a8cc0be9633ee00b3870884a944`; digest `0x5e29ec43009d2d268edd2f56ffae95e96b1b661ae067a7f4a83f8701da8b17ab`. Replay reverted with `EvidenceIdTaken` in block 21 (status 0). |
| Claim challenge and correction | The demo claim was recorded, the duplicate was rejected, then a separate challenge and correction preserved the originals and linked revised records. | Claim `cl-bde28af553bbb89ee8fb2e87` submitted in block 22. Challenge transaction `0x57ea1540a99cf64b104d1cb5a9134f5d65c9009d5987437b952c0aafb4bf55e3` in block 24. Correction retained original evidence/claim and linked revised evidence/claim in blocks 25–26. |

The addresses on this fresh launcher run are `EvidenceAnchor 0x5FbDB2315678afecb367f032d93F642f64180aa3`, `EnvironmentalEvidenceRegistry 0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512`, and `ClimateClaimRegistry 0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0`. They are local development deployments and are recreated when the local chain restarts.

## Browser and runtime checks

- 32/32 dashboard destinations rendered, including five lazy-loaded core views after their loading state settled; no route-level page errors or HTTP 5xx in the route sweep.
- Search-to-route, command palette, browser back/forward, pinning, saved layout after reload, mobile menu, retry after an intentionally interrupted overview request, and recovery were exercised.
- At viewport widths 390, 768, and 1440 px, the document stayed within the viewport (375, 753, and 1425 px respectively at measurement time); no horizontal overflow was observed.
- Four pinned panels (Command center, Satellite climate globe, Unified mission studio, Climate Integrity Lab) rendered at 1440×1000 with two Cesium viewers. A five-second animation-frame sample reported 60.2 mean frames/s and 16.8 ms p95 frame spacing; Chromium heap reported 45.9 MB. Navigating to the mission path released both Cesium viewers/canvases. This is one local machine/sample, not a performance guarantee.
- Browser evidence images: [four-panel view](../output/playwright/final-mission/four-panel-1440.png), [solar globe interaction](../output/playwright/final-mission/earth-solar-1440.png), [Integrity Lab proof](../output/playwright/final-mission/integrity-proof-1440.png), [Cascade manifest proof](../output/playwright/final-mission/cascade-chain-proof-1440.png).

## Re-verification on the final build

Run on 2026-10-23 with `node scripts/browser-audit.mjs` against the relaunched launcher, after the Command center, the shared place context and the `/api/status` change. The audit loads each destination in headless Chromium and records titles, uncaught errors, console errors, HTTP responses of 400 or more, failed requests, horizontal overflow, error boundaries and loading panels. It does not click the controls of each destination; the rows above are for the workflows named there.

Totals over the 96 page loads (32 destinations at 390, 768 and 1440 px): titles matched 96; horizontal overflow 0; error boundaries 0; uncaught page errors 0; HTTP 400 or more 0; console errors 1; failed requests 6; loading panels left visible 1.

| Destination | 390 px | 768 px | 1440 px |
|---|---|---|---|
| Command center | ok | ok | ok |
| Earth intelligence | console 6; failed request 6 | ok | ok |
| Waste · DumpWatch | ok | ok | ok |
| Fire · AshAlert | ok | ok | ok |
| Water · TapAlert | ok | ok | ok |
| Air · AirPulse | ok | ok | ok |
| From signal to proof | still loading | ok | ok |
| Unified mission studio | ok | ok | ok |
| Climate Cascade Review | ok | ok | ok |
| Climate Integrity Lab | ok | ok | ok |
| Review desk | ok | ok | ok |
| Evidence ledger | ok | ok | ok |
| Connected climate tools | ok | ok | ok |
| Engineering memory | ok | ok | ok |
| DumpWatch | ok | ok | ok |
| AshAlert | ok | ok | ok |
| TapAlert | ok | ok | ok |
| AirPulse | ok | ok | ok |
| BlueTrail | ok | ok | ok |
| ClaimGuard AI | ok | ok | ok |
| CarbonScope | ok | ok | ok |
| SinkGuard | ok | ok | ok |
| UniqueCredit | ok | ok | ok |
| HourSync | ok | ok | ok |
| ParcelSeal | ok | ok | ok |
| SupplyTrail | ok | ok | ok |
| ImpactGraph | ok | ok | ok |
| grounded | ok | ok | ok |
| TonneTrail | ok | ok | ok |
| MethaneMend | ok | ok | ok |
| TorchSight | ok | ok | ok |
| WattCert | ok | ok | ok |

Transient results, not reproduced on clean reruns:

- Earth intelligence at 390 px: six `ERR_FAILED` requests for Esri satellite tiles and one console error. Clean reruns at 390 px had none. The app already shows its imagery warning when tiles fail.
- Guided mission path at 390 px: still on its lazy-load fallback after the settle window once (34 s). Reruns loaded in about 4 s.
- `GET /api/agent-memory` returned 503 once during a run on TorchSight at 390 px. The gateway returns 503 with a stop message when the local sandbox fails, and the launcher logs show Windows DPAPI helper failures from earlier runs. The route then returned 200 for 30 consecutive requests. The cause is not identified; see the verification record.
- `GET /` returned 404 once while a second launcher rebuilt `frontend/dist`. The build empties the folder before writing it.

