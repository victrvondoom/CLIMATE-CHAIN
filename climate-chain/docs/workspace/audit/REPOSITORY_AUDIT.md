# ClimateChain OS repository audit

Audit date: 2026-10-21

## Scope and evidence standard

The workspace contains 13 project directories, including the integrated Climate Chain shell and 12 specialist projects, plus the root README. There is no shared Git root or per-project .git directory in this checkout. Findings were checked against source trees, route handlers, schemas, package manifests, tests, deployment files and license files where present. Hosted deployments and README-reported field results were not independently probed.

Statuses follow the master prompt: **implemented and verified** means the behavior and a local check were exercised; **implemented but not verified** means source exists without a focused runtime check; **partially implemented** means the workflow is incomplete; **documentation only** means no executable implementation was found; **simulated** means demo, synthetic, replay or estimated behavior; **broken** means a checked failure or misleading behavior prevents the described use; **missing** means no implementation was found; **external dependency** means a remote API, cloud service, hardware, chain or credential is required.

## Repository shape

- Climate Chain is a React 19, TypeScript, Vite frontend plus a dependency-free Node HTTP gateway. It has four configured upstreams and no central database, user identity, case store, intervention service or audit-event log.
- The projects are not a package-manager monorepo. They have independent runtimes, package managers, databases, identities and deployments. Their native applications remain separate.
- This execution adds a read-only, versioned /api/v1/cascade route and a place-based review screen. It checks an open public DumpWatch site against AirPulse's read-only Today API using source mode, timestamps, nearest-monitor distance and chosen thresholds. It does not write to either source.
- The route emits a SHA-256 evidence manifest for export. The digest is not an append-only audit log, independent signature or immutable storage.

## Runtime inventory

| Project | Source-confirmed runtime and persistence | Readiness and dependencies |
|---|---|---|
| climate-chain | React/TypeScript/Vite/Three.js; Node 20+ built-in gateway; no database | Four upstream APIs; new local tests pass, live upstream not probed |
| DumpWatch | Node 24/Fastify, React/MapLibre, Python ML, Android/Tauri; DynamoDB/S3/SQS | AWS EKS/Amplify documented; site DTOs are public, reports/writes have ownership controls |
| AshAlert | Python 3.12 Lambda/SAM, React dashboard, DynamoDB, WhatsApp jobs | Demo/seed and WhatsApp simulator modes; public stats can mix synthetic data |
| teesri-shikayat | Python 3.13 Lambda/CDK, Telegram, Transcribe, Step Functions, Cedar; DynamoDB | Current global state snapshot; no versioned incident API |
| the-vayu-project | Node 22+/TypeScript monorepo, React, Lambda/CDK, ESP32-S3 | OpenAQ/Open-Meteo etc.; public monitors and room hardware are distinct paths |
| CarbonScope | Python ML, JavaScript/Hardhat/Solidity | Offline demo; Sentinel-2-like scenes are simulated |
| SinkGuard | Python research/FastAPI, precomputed artifacts | Read-only research sensitivity API; source/data rights unresolved |
| UniqueCredit | Python pipeline, Node/TypeScript static site, local EVM harness | Read-only candidate findings; contract guard is not a public deployment |
| ImpactGraph | Python graph/API/MCP, Flutter/web, FalkorDB | Planted cases and ledger are synthetic; decisions mutate a demo graph |
| MethaneMend | Python/FastAPI, Next.js, PostGIS, Solidity | Historical Carbon Mapper data; repairs/funding are simulated |
| grounded | Node 22+/pnpm, Fastify/WebSocket, SQLite, React | Research simulator; not a site-validated digital twin |
| BlueTrail | Static JavaScript PWA, Leaflet/service worker, LocalStorage | Frontend prototype with simulated API; no server API found |
| SupplyTrail | Next.js 15/React 19, TypeScript, Solidity/Web3 | Broad demo UI; fallback transaction results were misleading and are corrected below |

## Central API and data boundary

Existing routes: GET /api/services; GET /api/unified/overview; GET passthrough /api/{junksnap,clearsky,teesri,vayu}/*. Overview independently labels source data live or mock. Ordinary GET /api/v1/cascade?site=... requests require valid thresholds and do not replace failed live source calls with simulated readings. An explicit demo=1 option serves local fixtures, makes no upstream request and remains ineligible for a candidate.

The cascade envelope separates DumpWatch last-reported time from AirPulse observation, fetch and as-of times. It requires an open, located site, live upstreams, station provenance, named monitor, non-negative PM2.5, a reported distance, and non-future timestamps within the selected freshness/time window. Model, replay, forecast, fallback and missing evidence cannot qualify. AirPulse does not return the station's exact coordinates; its distance is from the rounded query point, so the UI does not plot a monitor marker.

The former overview feed combined AshAlert regional counts with a selected AirPulse city and stated causal relationships without a shared time/location key. It also described Jodhpur and Mumbai signals as the same cities. This execution removes these claims. The overview now shows source-level signals and routes users to evidence-gated Cascade Review.

TapAlert's API state includes household-level fields. The central normalizer and state proxy now return aggregate counts only; household identifiers, message content and coordinates are omitted. Source-owned case and resident actions remain outside Climate Chain.

## Project audit and source boundaries

### Civic projects

- **DumpWatch:** public read-only GeoJSON/site APIs expose locations, verification counts and report timestamps; private report/media and writes use separate Cognito/ownership controls. README field-run results were not reproduced. AGPL-3.0; do not copy source without meeting its license.
- **AshAlert:** public stats/impact are aggregates; field/village/officer routes require role access. Seed metadata marks approximate coordinates, synthetic farmer/field rows and demo prices. A provenance-separated public aggregate is needed before treating counters as verified live activity. Python metadata says MIT but no root LICENSE was found.
- **TapAlert:** read-only global current-state snapshot, not versioned incidents. Tripwire and resident closure rules exist in source. API may contain rounded household locations or message-related fields. MIT license.
- **AirPulse:** Zod-validated read-only routes carry source mode, monitor name, distance, observed/fetched/as-of time and age. It distinguishes station data from models and replay. Hardware is a separate source. MIT license.

### Carbon, methane and resilience

- **CarbonScope:** local demo; forest scenes are simulated. Contract uniqueness is scoped to project and monitoring period inside that contract. MIT license.
- **SinkGuard:** research sensitivity tests over precomputed artifacts, not fraud determinations. Follow-up inspection on 2026-10-22 found a phase-3 React auditor UI and read-only FastAPI artifact API in the source folder; Climate Chain does not integrate that API. No root license; rights must be clarified before code/data reuse.
- **UniqueCredit:** static candidate findings with registry attribution and local model adjudication; overlap pairs are reconciliation leads, not proof. Code MIT; Berkeley source data CC BY 4.0.
- **ImpactGraph:** synthetic ledger and planted fraud cases; reported detection metrics apply only to that synthetic evaluation. Its decision API mutates the demo graph. MIT license.
- **MethaneMend:** read-only source-aware historical Carbon Mapper data API. Repair, evidence, escrow and payments are simulated here; no live contract deployment was checked. Code MIT; retain Carbon Mapper attribution/terms.
- **grounded:** executable dispatch/optimization and holdout validation in its own SQLite state store. It labels outputs as decision-support simulation; no root LICENSE found.

### Community and governance

- **BlueTrail:** offline PWA prototype, browser-stored simulated API and no server API/tests found. MIT license. Its Bangladesh locations do not join the India civic feeds.
- **SupplyTrail:** MIT license. Several fallbacks produced random transaction hashes or proposal IDs after chain failures. Those write-failure paths now throw user-visible errors. Its Pinata upload route used hardcoded credentials; the source now reads PINATA_JWT from server environment and returns 503 when absent. Provider-side credential rotation remains necessary and was not performed. Some marketplace and certificate paths remain demos.

## Compatibility and integration risks

- Runtime versions differ: Node 20+, 22+ and 24; Python 3.12 and 3.13. There is no shared runtime contract.
- API shapes differ: unversioned DumpWatch GeoJSON, AshAlert /api, TapAlert /api/state, AirPulse /v1, MethaneMend /api/v1. Keep source-specific adapters and schema validation.
- AWS, external data providers, Carbon Mapper, registry data, model APIs, Pinata, wallets and RPCs have separate availability, cost and terms.
- No confirmed shared identifier links sites, fields, households, registry claims, plumes or energy scenarios. Geographic-temporal overlap is a triage lead, not causality.
- No shared identity/role model exists. Central write-through routes would bypass specialist permissions.

## Licensing and attribution

Known LICENSE files: DumpWatch AGPL-3.0; TapAlert, AirPulse, CarbonScope, UniqueCredit, ImpactGraph, MethaneMend, BlueTrail and SupplyTrail MIT. UniqueCredit's Berkeley source dataset is CC BY 4.0. AshAlert metadata says MIT but has no root LICENSE. SinkGuard and grounded have no root LICENSE in this checkout. This central gateway integration consumes HTTP contracts and does not copy specialist implementation.

## Verification in this execution

- Gateway: 14 Node built-in tests pass, including HTTP integration with deterministic local upstream fixtures, opt-in demo isolation, explicit upstream failure behavior, TapAlert aggregate redaction and missing-outcome checks. This is not a public upstream availability check.
- Frontend: TypeScript check and production Vite build pass. Three.js is a separate, lazy-loaded 553 kB minified chunk.
- SupplyTrail TypeScript check and Next production build pass after a frozen-lockfile dependency install and enabling build-time type validation. The standalone lint script still prompts for ESLint setup. Other specialist full suites were not run. README test counts and deployment/results remain project-reported.
- No deployments, notifications, payments, on-chain transactions or external credential rotations were performed.
