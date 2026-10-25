# Integration map

Climate Chain is the central navigation and mission workspace for the 18 project folders. This map separates the four sources that currently feed the shared API from the specialist projects that are connected through the mission path and capability library.

## 1. The five-step mission path

| Step | User question | Connected capabilities |
|---|---|---|
| **Sense** | What is happening, and where? | DumpWatch, AshAlert, TapAlert, AirPulse, BlueTrail, MethaneMend, plus the Climate Chain command center |
| **Verify** | What evidence supports the signal, and what rule lets it count? | DumpWatch's resident backing, TapAlert's neighborhood tripwire, AirPulse provenance, CarbonScope, SinkGuard, UniqueCredit, ImpactGraph, MethaneMend |
| **Act** | Which team or mechanism can change the condition? | DumpWatch, AshAlert, TapAlert, AirPulse hardware, BlueTrail, Resilia, MethaneMend |
| **Finance** | How is the intervention funded or credited? | MethaneMend escrow, CarbonScope registry, UniqueCredit issuance guard, ImpactGraph review, SupplyTrail demo |
| **Prove** | What changed, and how do we avoid overstating it? | Source-specific evidence, CarbonScope reversals, UniqueCredit Merkle findings, ImpactGraph human review, MethaneMend receipts, Resilia validation, community reporting |

Project cards retain a readiness label: live app/API, read-only snapshot, demo, research foundation, or prototype. Mission guidance recommends a tool; it does not execute its writes or replace its specialist checks.

The **Unified mission studio** lets a user include capability sets from any of the 18 folders, arrange them under these five stages, and export a Markdown mission brief with project features, readiness and evidence notes. Four API-backed projects show their current live/simulated mode. The remaining modules are native re-implementations on bundled fixtures (8 SIMULATED, 6 RESEARCH, 4 DEMO; the original project folders are not included in this repository); the brief does not imply shared storage, execution, or verified cross-project impact.

## 2. Project-to-capability map

| Folder / project | Main contribution | Source state in the central workspace |
|---|---|---|
| `climate-chain` | Command center, 3D data view, guided path, cross-project signals | Central app; gateway integrates four APIs |
| `JunkSnap-main` | Waste photos, privacy blur, stacked checks, 10-person verification, ward/MLA/MP mapping, cited letters | Live app and API; normalized Waste view |
| `clearsky-main` | WhatsApp field registration, baler and buyer routing, Burn Risk Radar, village alerts | Live app and API; normalized Fire view |
| `teesri-shikayat-main` | Voice/text water complaints, 3-home/250 m/72 h tripwire, resident-only closure | Live console/API and Telegram bot; normalized Water view |
| `the-vayu-project-main` | Monitor-backed air exposure, 24-hour dial, assistant, room sensor and air cleaner | Live app and API; normalized Air view |
| `AquaQuest-main` | Freshwater map, guided observations, reports, challenges, learning and community feed | PWA prototype with local/mock data |
| `PLUME-main` | Carbon Mapper plume records, repair ranking, EIP-712 verifier-gated escrow (exists in the upstream project only; not executed here), public receipts | Read-only app snapshot; local workflow and repair actions have simulated elements |
| `carbonlens-main` | Forest classification, bias correction, reversal checks, unique credit serials and report hashes | Demo dashboard and synthetic project cases |
| `carbonshield-main` | REDD+ baseline, leakage, measurement and carbon-stock red-team review | Local phase-3 React auditor UI and read-only FastAPI artifact API; research-scope handoff with no central adapter |
| `carbontwin-main` | Cross-registry matching, LLM adjudication, contract issuance guard and Merkle findings | Read-only demo; matching results are demo findings |
| `ecograph-main` | Carbon-ledger graph checks, explainable score, 11 MCP tools and human-reviewed freeze decisions | Live demo with synthetic evaluation cases |
| `grounded-main` | 72-hour microgrid dispatch, policy search, holdout validation and investment search | Public research and decision-support app |
| `rantai-3c-master` | Carbon workflow demo with Sepolia contracts, NFT, DAO and marketplace paths (exist in the upstream project only; not executed here) | Source project; some flows are simulated. Its README's public URL currently leads to an unrelated site, so the hub links to the source repository. |

## 3. Shared API boundary

Only four upstreams are currently normalized in `gateway/services.mjs`:

| Gateway route | Upstream | Normalized contribution |
|---|---|---|
| `/api/junksnap/sites` | DumpWatch `/sites?bbox=…` | Waste site coordinates, status, type and backing counts |
| `/api/clearsky/api/stats` | AshAlert `/api/stats` | Risk fields, acres, straw, bookings, alerts and estimated payouts |
| `/api/teesri/api/state` | TapAlert `/api/state` | Aggregate report, warning and ring counts; household identifiers, messages and coordinates are omitted |
| `/api/vayu/v1/today` | AirPulse `/v1/today?lat&lng` | Selected place, PM2.5 series, severity and data mode |
| `/api/services` | Four upstream health probes | Current reachability for the connected APIs |
| `/api/unified/overview?city=…` | Parallel fan-out to those four sources | One overview payload and source-level signals |
| `/api/v1/cascade?site=…&radiusKm=…&timeWindowHours=…` | DumpWatch public site + AirPulse Today at that site point | Read-only evidence checks, proximity status and exportable SHA-256 manifest |

Each request has a timeout. Overview fallback data carries `mode: "mock"` and the UI calls it **SIMULATED**. Passthrough routes preserve the source method and forward caller-supplied authorization; Climate Chain does not issue project credentials. TapAlert's state route returns only an allowlisted aggregate and does not pass household identifiers, messages or coordinates to the central client. Ordinary Cascade requests use live sources only and return a clear source error when either call fails. The explicitly requested `demo=1` route uses local fixtures, makes no upstream call, labels the response simulated and cannot produce a review candidate.

The eight other specialist project folders are not currently API-connected. They are listed and placed into the mission steps as native modules re-implemented in climate-chain/frontend/src/modules on bundled fixtures (the original project folders are not included in this repository), with their readiness and evidence limits shown. Climate Chain itself is the central app, not an additional upstream. The specialist projects' native APIs, stores, sign-ins, and write operations are not silently reinterpreted as unified Climate Chain data.

## 4. Data and privacy rules

- **Live vs. simulated:** the overview and each source badge use the gateway's per-source mode. Research and demo metrics on capability cards are labeled with their origin and are not presented as live counters.
- **Location:** the globe shows public DumpWatch site coordinates and the AirPulse query place, and intentionally omits household coordinates. AirPulse Today does not return exact monitor coordinates, so the Cascade page does not plot the station.
- **Cascade join:** proximity and recency checks create a review lead only. They do not establish causality or a pollution source. The manifest digest is not independently immutable.
- **No combined impact claim:** the hub does not add results from incompatible baselines or datasets into one verified climate total.
- **Specialist evidence:** the source project remains responsible for thresholds, consent, auth, decision approvals, and any on-chain execution.
- **External handoff:** opening a capability is a navigation action only. It does not submit a report, close a case, book equipment, issue a credit, release funds, or freeze a registry.

## 5. Run locally

The frontend is `frontend/`; the zero-dependency Node gateway is `gateway/`. See [`README.md`](README.md) for the startup commands and environment variables. The product UI uses the unified `/api` base path; Vite proxies that path to the local gateway during development.

## 6. Waste-to-Air review

From Waste, select an open public DumpWatch site and choose **Review nearby air context**. The gateway loads the site timestamp and location, requests AirPulse Today for its rounded query point, and checks that both sources are live, AirPulse reports a station observation, the monitor distance is within the chosen radius, and both observations are recent and within the chosen window. Unknown or simulated evidence cannot pass.

The UI presents the result, failed/unknown checks, station attribution, age and source URLs. A user may export the evidence manifest and then continue in DumpWatch. The central step is read-only and does not create, approve or close an incident.
