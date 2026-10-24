# Project Genesis — engineering delivery report

**Date:** 2026-10-22  
**Scope verified:** central Climate Chain workspace (`climate-chain/`) plus a source-level inventory of 13 capability sets.  
**Delivery status:** meaningful dependency chain implemented and verified; Genesis acceptance criteria as a whole are not complete.

## Initial state and architecture

The workspace contains the central Climate Chain React/Vite app and twelve specialist project folders, each with separate frameworks, storage, identities, and maturity. The central product already had a four-source dashboard, Cascade read review, a local memory studio/MCP read bridge, and browser-local mission simulation. The specialist apps were not a single deployable backend. The full source inventory and dependency graph are in `GENESIS_ARCHITECTURE.md` and `INTEGRATION_MATRIX.md`.

The workspace has no verified root Git history. No history was created. The regular user vault was not inspected, overwritten, or used by test flows.

## Implemented

- Connector registry for four existing read adapters: contracts, typed schema checks, a default 2 MiB response limit enforced on declared and streamed body size (including health checks), timeout, bounded retry, circuit breaker, TTL cache bounded by 128 entries and 16 MiB serialized payload bytes, freshness and provenance, connection status, and explicit simulated fallback state. Vayu overview and mission paths share one reviewed city-preset table.
- Local durable mission API/store, separate polling worker process, and launcher supervisor: versioned checksummed JSON, atomic writes, cross-process locks, DAG and task allowlist validation, idempotency, fresh memory-context lease checks, expired-lease recovery, capped exponential worker restart, IPC shutdown, bounded retries, approval gates, cancellation/pause/resume, event history, evidence, export/import.
- Worker-side ClearSky aggregate and Vayu city-center refreshes through the connector registry: strict source/input allowlists, response-schema validation, aggregate or bounded PM2.5 projections, abortable timeout, retry policy, provenance in task evidence, and dependent reports. Vayu persistence omits coordinates, place/station identifiers and free-text rationale. Individual household/place connector payloads are not mission-readable.
- Mission Studio integration: backend mission creation and controls, source provenance, event timeline, evidence view, report export, health state, and browser reload persistence. The browser-local dry-run remains a separate accurately labeled workflow.
- Memory readiness before mission execution: vault integrity, project-scoped lexical/graph recall, declared conflict check, manifest digest, and retrieved-ID trace in evidence. Retrieval is recorded and deterministic handlers do not interpret memory instructions.
- Authenticated AES-256-GCM memory storage and retrieval audit; Windows DPAPI CurrentUser key protection, encrypted automatic backups and reviewed key rotation; fail-closed decryption; browser-side passphrase-encrypted portable backup. Legacy plaintext migration copies remain preserved and visible as warnings.
- Gateway local boundary hardening: explicit IPv4 loopback bind at startup, read-only legacy upstream proxy, no wildcard CORS, and exact reflection for local origins. Memory/Mission routes retain separate local checks.
- Health and correlation metadata including atomic worker heartbeats and stale/missing/corrupt readiness; frontend health/evidence/source detail; ESLint/Vitest tooling; mobile timeline overflow fix.
- Operations, memory, security, connector, agent execution, verification and progress documentation.

## Real versus simulated

Four APIs have typed read adapters, but all upstreams were unavailable during the browser smoke, so the overview showed explicit simulated fallbacks. Fixture servers in the gateway tests exercised successful schema/provenance paths. No current production observation is claimed.

The durable mission engine supports three deterministic local handlers plus read-only ClearSky aggregate and Vayu city-preset connector reads. Isolated worker tests validated both responses, verified the Vayu privacy projection, recorded provenance, and completed a dependent report. This proves the local connector execution path; it does not prove a current external upstream is reachable. The manual browser smoke found all upstreams disconnected, so no production observation is claimed. The launcher supervises the worker with capped backoff, but there is no durable broker or OS service to recover if the supervisor itself exits. This is not a model-backed agent team. The emissions scenario remains illustrative. Evidence proves local task execution and source classification, not climate impact.

The memory vault has encryption at rest on Windows. Its storage remains JSON rather than SQLite, with lexical and explicit-graph retrieval rather than semantic vectors. External agents must separately install MCP/rules; the application cannot enforce universal recall.

## Verification results

| Command/flow | Result |
|---|---|
| `npm test` (`climate-chain/gateway`) | 80 passed, 0 failed, 0 skipped |
| `npm run lint` (`climate-chain/frontend`) | Passed |
| `npm test` (`climate-chain/frontend`) | 8 passed, 3 files |
| `npm run typecheck` (`climate-chain/frontend`) | Passed (also run within `npm run build`) |
| `npm run build` (`climate-chain/frontend`) | Passed |
| Playwright CLI browser flow | Mission create/validate/memory-gate/queue, separate worker execution, evidence/export/reload passed; server-side record remained available after reload; 0 normal console errors/warnings |
| Separate worker connector integration | Local ClearSky and Vayu fixture reads, schema validation, aggregate/PM2.5 privacy projections, provenance evidence, dependent report, and gateway restart persistence passed |
| Worker supervisor and launcher | Injected worker crash restarted with capped backoff; status missing/fresh/stale/corrupt and backoff-aware restart tests and degraded readiness passed; actual `start.ps1` returned ready with a running heartbeat and HTTP 200, then Ctrl+C left no child processes |
| Encrypted memory runtime | Isolated launcher query and retrieval returned a trace; encrypted audit file contained neither query nor memory ID in plaintext; frontend HTTP 200; shutdown left no child processes |
| Responsive width smoke | 390, 768, 1440 px; no page-level horizontal overflow |
| Current upstreams | Disconnected at smoke time; simulated fallback was visible |

Gateway tests cover proxy/CORS method policy, connector behavior including declared and streamed oversized response rejection and aggregate cache-byte eviction, mission persistence/recovery/evidence, memory integrity/encryption/concurrency/MCP and related regressions. Cache accounting measures serialized payload bytes, not parsed JavaScript heap use. Full command details are in `TEST_STRATEGY.md` and `TEST_RESULTS.md`.

The isolated gateway HTTP integration test separately restarts the gateway process and verifies that the completed mission and evidence remain available.

Tests used isolated temporary memory and mission roots. One synthetic manual-browser QA directory remains under `%TEMP%` because the execution safety layer rejected recursive cleanup; it is separate from the user's vault and contains test-only data.

## Performance

The final Vite build reports the lazy-loaded `Globe3D` chunk at 553.57 kB minified / 138.68 kB gzip, above the 500 kB advisory. A named-import tree-shaking experiment produced identical output and was reverted, so no performance gain is claimed. The app's main JS chunk is 310.27 kB minified / 94.80 kB gzip.

## Known gaps and security limitations

- Mission store is JSON; no SQLite migration or SQLite rollback was implemented. Storage is local, atomic, checksummed, and locked, but not a shared database.
- Worker is a separate local polling process with bounded steps and leases. The local launcher supervisor restarts worker crashes, but is not an OS service and has no external durable broker; restarting the host/supervisor still requires rerunning the launcher.
- No eight-role multi-agent scheduler, LLM call, semantic vector retrieval, signature-verifiable evidence, or automatic secret/PII detector.
- Memory recall can miss paraphrases and only detects declared conflict links. Same-user local processes can access the vault/API; DPAPI does not defend against malware as that user. Older plaintext migration copies are deliberately preserved.
- No authentication exists for remote hosting; gateway is bound to loopback. Do not publish or tunnel this gateway.
- Only four connector sources exist centrally, and only ClearSky aggregate statistics plus Vayu city-center PM2.5 samples are exposed to persisted missions. Specialist apps remain independent; upstream services were unreachable during the manual smoke. Cascade and source adapter owner approvals remain source-specific.
- Microphone transcription, remote agent installation, hosted CI, deployment, penetration test, and all twelve requested failure injection scenarios were not verified. Browser smoke was CLI-driven, not an automated E2E suite.
- Globe bundle advisory remains. This run did not rerun every sibling-project test suite.

## Exact startup and verification commands

From the workspace root, start the integrated application in PowerShell with:

```powershell
cd .\climate-chain
.\start.ps1
```

The launcher builds the frontend, then starts the process supervisor, loopback gateway, and local polling worker. Open `http://127.0.0.1:8080`; stop the launcher with Ctrl+C. For checks, run `npm test` from `climate-chain/gateway`, then `npm run lint`, `npm test`, `npm run typecheck`, and `npm run build` from `climate-chain/frontend`. Full setup and environment details are in `OPERATIONS_RUNBOOK.md`.

## Changed areas

Notable source changes are under `climate-chain/gateway/` (`gateway.mjs`, `mission-engine.mjs`, `mission-readiness.mjs`, `mission-worker.mjs`, `mission-task-executor.mjs`, `agent-memory.mjs`, `memory-crypto.mjs`, `connectors/registry.mjs`, `package.json`, and gateway tests), `climate-chain/start.ps1`, and `climate-chain/frontend/` (`src/api.ts`, `src/modules/MissionRuntime.tsx`, `src/modules/AgentMemory.tsx`, `src/styles.css`, `src/types.ts`, `src/App.tsx`, frontend tests, package scripts, and ESLint config). Documentation is under the workspace `docs/`. No unrelated specialist runtime was rewritten.

## Recommended next work

Extend connector-backed mission reads one source-specific privacy and schema adapter at a time. Add semantic retrieval only as an opt-in local model with privacy tests. Integrate specialist adapters after validating project-owned authorization and data contracts. Split or defer-load the globe and measure browser performance. Build an automated browser accessibility/responsive suite and root CI that respects specialist project boundaries.
