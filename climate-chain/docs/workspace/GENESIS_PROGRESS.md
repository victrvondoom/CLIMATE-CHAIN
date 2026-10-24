# Project Genesis — progress checkpoint

**Checkpoint:** 2026-10-22  
**Workspace:** this folder; central application is `climate-chain/`.  
**State:** dependency-chain prototype implemented and reverified; broader Genesis mission remains in progress.

## Completed and verified

- Reconstructed the 13-capability workspace and retained independent source-project ownership. The forensic inventory and original dependency graph are in `GENESIS_ARCHITECTURE.md`; the detailed capability map is in `INTEGRATION_MATRIX.md`.
- Added a connector registry for the four existing read sources with typed operation contracts, response validation, bounded retry, timeout, circuit breaker, short TTL cache, freshness and provenance. `/api/connectors`, `/api/services`, `/api/unified/overview`, and `/api/health` expose the relevant state. In the current browser smoke, all four upstreams were unreachable and correctly appeared as disconnected with simulated overview fallback.
- Capped connector and health response bodies at 2 MiB by default (operator-configurable to at most 64 MiB); both declared and streamed byte counts are enforced. Rejected oversized source bodies are visible connector failures and covered by tests. The response cache is limited to 128 entries and 16 MiB of serialized payload; parsed-object heap overhead remains higher. Gateway overview and mission worker now share the same reviewed Vayu city preset table.
- Added a checksummed, atomic, locked, versioned local mission store under user data. It supports DAG validation, explicit mission/task transitions, idempotent creation, leased task claims and recovery, bounded retry, pause/resume/cancel, approval checkpoints, event history, evidence, and definition export/import. `mission-supervisor.mjs` now starts the gateway and restarts an unexpectedly exited polling worker with capped exponential backoff; Ctrl+C stops both. Restart recovery reclaims expired leases.
- Added deterministic, allowlisted mission tasks for observation summaries, illustrative emissions scenarios, and Markdown reports, plus worker-side ClearSky aggregate and Vayu city-center refreshes through the connector registry. ClearSky uses a fixed aggregate-field allowlist. Vayu accepts only the three configured city keys, retains at most 24 PM2.5 samples with their reported data kind, and omits coordinates, place/station identifiers, and free-text rationale. No mission has shell, general filesystem, database, or arbitrary network access. Mission execution verifies memory readiness, performs scoped lexical/graph recall and declared-conflict checks, and records retrieved IDs and manifest. Evidence explicitly says handlers retrieve identifiers but do not interpret stored instructions.
- Added a backend-persisted mission panel while retaining the separate browser-local planning/dry-run capability. The local mission path creates a mission, validates it, passes memory readiness, queues the permitted deterministic tasks to the separate worker, displays source/evidence state, exports a report, and survives browser reload. An isolated gateway HTTP test separately verifies process-worker execution and persistence after gateway restart.
- Hardened memory content at rest with AES-256-GCM. Windows uses a DPAPI CurrentUser-protected keyring, automatic encrypted backups, and reviewed key rotation. The active encrypted vault fails closed on corruption or key mismatch; plaintext migration input is preserved instead of silently deleted. Portable exports can be encrypted in the browser with PBKDF2-SHA-256 and AES-256-GCM.
- Encrypted retrieval audit metadata at rest with the same authenticated vault key when encryption is active. Legacy JSONL traces are preserved byte-for-byte and migrated on the next append, surfaced as a plaintext-copy warning, and never used as fallback if the active ciphertext is corrupt.
- Hardened the shared gateway: the launched server binds to `127.0.0.1`, the legacy source proxy rejects writes, wildcard CORS was removed, and only local browser origins are reflected. Mission and memory APIs retain their stricter local boundaries.
- Added correlation IDs, combined service/vault/mission/worker health, frontend health indicators, evidence and event views, encrypted backup controls, responsive overflow fixes, ESLint, and Vitest. Worker status is atomically recorded outside the source tree, reports missing/corrupt/stale heartbeats explicitly, and gates gateway readiness; the UI polls and explains recovery actions.
- Manually exercised the browser mission flow and reload persistence with Playwright CLI. Desktop 1440 px, tablet 768 px, and mobile 390 px had no page-level horizontal overflow. Normal-workflow console had 0 errors and 0 warnings in that run.

## Current verification

| Check | Result |
|---|---|
| `npm test` in `climate-chain/gateway` | **80 passed, 0 failed, 0 skipped** |
| `npm run lint` in `climate-chain/frontend` | Pass |
| `npm test` in `climate-chain/frontend` | **8 passed** across 3 files |
| `npm run build` in `climate-chain/frontend` | Pass; includes `tsc --noEmit` and Vite production build |
| Bundle measurement | Globe3D lazy chunk **553.57 kB min / 138.68 kB gzip**; main app **310.27 kB min / 94.80 kB gzip**. The Globe3D chunk remains above Vite's advisory; named-import experiment did not change the output and was reverted. |
| Mission browser workflow | Create → validate → queue → execute → inspect evidence → export → reload; completed record remained available. A separate HTTP integration test exercises worker-side ClearSky and Vayu fixture reads, validates privacy projection/provenance, and completes a dependent report. |
| Worker supervision and health | Missing, fresh, stale, corrupt, and scheduled-restart backoff status cases tested; injected worker crash → capped restart → IPC shutdown; actual launcher returned ready/running with a fresh heartbeat, frontend HTTP 200, and Ctrl+C left no orphan processes. |
| Encrypted audit runtime smoke | Isolated `start.ps1` launch on port 8191 reported encrypted vault/audit policy, returned a retrieval trace after search, and stored no query or memory ID in plaintext; frontend returned HTTP 200; Ctrl+C left no gateway/worker processes. |
| Responsive browser smoke | 390, 768, and 1440 px; no horizontal page overflow |
| Current upstream health | Disconnected during smoke; UI exposed simulated fallback and per-source failure state |

The gateway and frontend suites were rerun after worker liveness integration. Exact commands and limits are in `TEST_STRATEGY.md` and `TEST_RESULTS.md`.

## Deliberate limits and next dependency chain

This is not full Project Genesis completion. Mission persistence is checksummed JSON rather than SQLite. A local launcher supervisor restarts a crashed worker with capped backoff, but it is not an OS service and cannot recover if the supervisor or host exits. Agents are deterministic task handlers; there is no model-backed multi-agent planner, role delegation, semantic embeddings, or semantic conflict discovery. The four existing read adapters are the only central data integrations; only ClearSky aggregate statistics and Vayu city-center PM2.5 projections are directly callable by mission tasks. The sibling projects retain their own identity and approval boundaries. No deployment, hosted CI, remote agent installation, live upstream availability, or real microphone capture was verified.

Next, add bounded, source-owned privacy projections for JunkSnap and Teesri. Then add specialist adapters one at a time, based on source-owned contracts. Defer agent-model execution until tool authorization, context budgeting, trust handling and evidence acceptance can be independently verified. Connector response handling has a bounded default, but additional large/slow-body and cancellation cases should be exercised before widening deployed limits.

## Data preservation

No regular user vault was read, overwritten, populated, or cleared during these isolated tests. Test mission storage and memory roots used fresh temporary directories. No Git history was created or assumed.
