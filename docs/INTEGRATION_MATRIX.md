# Feature Integration Matrix

> Current central implementation and verification are documented in `GENESIS_FINAL_REPORT.md`. This matrix describes capability ownership and integration boundaries.

**Scope:** all 13 capability sets visible in Mission Studio, including the central app. “Live” means an actual current upstream was reachable at the time of a source fetch; an app link or project README claim alone is not live evidence. “Simulated” includes fixtures, local demo data and synthesized results.

| Capability | Source and dependencies | Real or simulated evidence | Current central usability | Integration status |
|---|---|---|---|---|
| Climate Chain | `climate-chain/`; React/Vite, Node gateway, source APIs, browser storage | Four gateway adapters; offline responses explicitly simulated | Command center, signal views, mission path, mission builder and review | Integrated as orchestration/navigation; no common identity or cross-project execution |
| JunkSnap | `JunkSnap-main/`; AWS Cognito, Fastify, SQS, DynamoDB, KMS/S3, Rekognition/Bedrock/Location | Upstream API can be live; project still owns original data and approvals | Normalized Waste view plus external live app | API adapter integrated; specialist writes remain handoff |
| clearsky | `clearsky-main/`; AWS APIs, marketplace workflow, WhatsApp intake, FIRMS and approvals | Upstream stats can be live; risk fallback is labeled simulated | Normalized Fire view plus external app | API adapter integrated; specialist actions remain handoff |
| Teesri Shikayat | `teesri-shikayat-main/`; Telegram/voice intake, Step Functions, Cedar/consent, datastore | Upstream console/API can be live | Normalized Water view and console link | API adapter integrated; resident decisions remain source-owned |
| The Vayu Project | `the-vayu-project-main/`; OpenAQ/Open-Meteo/MET Norway/FIRMS and optional ESP32 Bluetooth | Readings retain station/source/time provenance; fallbacks are labeled | Normalized Air view, city selection and project link | API adapter integrated; sensor control remains source-owned |
| AquaQuest | `AquaQuest-main/`; browser PWA/localStorage | Prototype behavior uses mock/local data; syntax sweep passed 42 JS files | Capability card and PWA link | Source-project handoff; no central data adapter |
| PLUME | `PLUME-main/`; Python/API, React, carbon/methane evidence stack | Read-only snapshot and local simulated workflow elements; production behavior not proven | Capability card and source-project handoff | Handoff only; do not treat snapshot or simulation as live action |
| CarbonLens | `carbonlens-main/`; demo dashboard, imagery/model pipeline | Synthetic cases and demo imagery/results | Capability card and dashboard link | Handoff only; no normalized central API |
| CarbonShield | `carbonshield-main/`; local React auditor UI and FastAPI read-only API | Research-stage measurements; local app/API exist, central adapter absent | Capability card and source UI | Handoff only; README/research scope and scientific provenance remain limitations |
| CarbonTwin | `carbontwin-main/`; registry matching and contract/report tools | Demo/static findings; contract/report tests pass 11/11 | Capability card and project tool link | Handoff only; no central registry writes |
| EcoGraph | `ecograph-main/`; ledger graph checks, MCP tools, human review | Demo uses synthetic evaluation cases; real ledger data integration not established | Capability card and source project | Handoff only; human review and source boundary preserved |
| Grounded | `grounded-main/`; microgrid optimization and decision-support app | Research/decision-support results, not a central live grid dispatch | Capability card and source app | Handoff only; no central actuation |
| Rantai 3C | `rantai-3c-master/`; Web3 contracts, marketplace and governance demo | Demo/testnet/source project flows; live impact evidence not established | Capability card and repository handoff | Handoff only; no central contract action |

## Shared contracts and dependencies

- The central gateway normalizes only four upstream schemas into typed waste, fire, water and air models.
- The five workflow stages and capability IDs are shared metadata in the central frontend, not shared project execution APIs.
- Agent memory is stored outside application source under the user's local application-data directory (or explicit override); the active Windows vault is AES-GCM encrypted with a DPAPI CurrentUser key; MCP is local stdio and read-only.
- The five-stage planning dry run remains browser-local and simulated. The separate durable local mission engine persists state and evidence on the gateway and runs only deterministic allowlisted tasks; it does not invoke specialist project actions.
- Specialist links preserve original authentication, source-of-truth, approvals and evidence rules.

## Evidence and open integration work

Baseline command outcomes for project builds/tests and missing dependencies are in `TEST_RESULTS.md`. An adapter for any other project should be added only after an authenticated, typed, provenance-preserving API contract is available; a capability tile is not evidence that such a contract exists.
