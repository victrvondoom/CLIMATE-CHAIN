# Feature Integration Report — Project Genesis

## Shared central capabilities

Climate Chain keeps all 13 capability sets discoverable through the central product, while their source projects retain independent data, identity, approval and runtime boundaries. `INTEGRATION_MATRIX.md` inventories each capability, dependencies, provenance and central integration status.

The central application now has:

- Four typed climate read adapters behind a shared connector registry, with schema validation, retry bounds, timeouts, circuit breakers, cache freshness and response provenance.
- A durable local mission engine and frontend controls. It validates dependency graphs and allowlisted task types, persists every event and output, supports leases/retry/pause/resume/cancel/human approval, attaches evidence, and survives a gateway restart.
- A local process supervisor that starts the gateway and worker, restarts worker crashes with capped exponential backoff, and performs IPC shutdown. The launcher and child-process recovery path were exercised.
- Worker-side AshAlert aggregate and AirPulse city-center reads through the typed registry. AshAlert is projected to reviewed aggregate fields. AirPulse accepts only three configured city keys, caps output to 24 timestamped PM2.5 samples with their reported data kind, and drops coordinates, place/station identifiers, and rationale. Both store schema/fetch provenance and can feed a dependent report.
- Three deterministic local task types and a separate prior browser-local five-stage planning simulation. The UI distinguishes real gateway persistence from simulated source observations and illustrative scenarios.
- A memory readiness gate for local mission runs, which verifies encrypted vault integrity, scoped lexical/graph recall and declared conflicts and attaches a retrieval manifest to evidence. Saved memory is never executed as trusted instruction.
- A Windows DPAPI-protected AES-256-GCM memory vault, encrypted backups, reviewed key rotation and passphrase-encrypted portable browser exports. MCP remains local stdio and read-only.
- Local-only health and correlation, evidence inspection, source details, report export, and responsive Mission Studio/Memory Studio interfaces.

## Source project boundaries

DumpWatch, AshAlert, TapAlert and AirPulse are the only central data-source adapters. Their source-project writes remain owner-controlled. BlueTrail, MethaneMend, CarbonScope, SinkGuard, UniqueCredit, ImpactGraph, Grounded and SupplyTrail remain searchable capabilities and handoffs, not centrally executed services. No common user identity, cross-project transaction bus, or unified impact total is asserted.

The separate local mission worker is intentionally constrained: it polls only tasks with a fresh gateway memory-readiness trace and cannot run shell, arbitrary filesystem, database, or arbitrary network tools. Its connector task supports only AshAlert aggregate statistics and AirPulse reads at configured city centers, each through its reviewed registry contract and output projection. The HTTP integration test exercised both paths against local fixtures; current external upstreams were unreachable during manual browser smoke, where the app displayed disconnected state and labeled fallback data simulated. No live production observation or impact is claimed.

## Current verification

The current central gateway suite passes 80/80; frontend ESLint passes; frontend Vitest passes 8/8; TypeScript and Vite production build pass. Connector regression tests include declared and streamed oversized-body handling and serialized-payload cache-budget eviction. Tests also cover encrypted retrieval-audit persistence, migration with plaintext-source preservation, corrupt-ciphertext fail-closed behavior, worker heartbeat freshness, corrupt/missing states, backoff-aware restart visibility, and readiness degradation. The spawned-worker fixture integration reads, validates and privacy-projects AshAlert aggregate and AirPulse city-center responses, records provenance, renders a dependent report, and survives gateway restart. Supervisor crash/restart/backoff and IPC shutdown tests pass. Isolated launcher smokes verified both fresh worker health and encrypted retrieval audit at rest; the app returned HTTP 200 and Ctrl+C left no child processes. Playwright CLI smoke created and executed a durable local mission, inspected and exported evidence, reloaded, and confirmed persistence. Viewports 390, 768 and 1440 px had no page-level horizontal overflow. Details and limits are in `TEST_RESULTS.md`, `TEST_STRATEGY.md`, and `GENESIS_FINAL_REPORT.md`.
