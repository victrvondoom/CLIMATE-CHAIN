# Verification strategy and results

## Repeatable central checks

Run from `climate-chain/gateway`:

```powershell
npm test
```

Run from `climate-chain/frontend`:

```powershell
npm run lint
npm test
npm run typecheck
npm run build
```

Gateway tests use local fixture HTTP endpoints and isolated temporary user-data roots. They cover connector contracts, retry/timeout/circuit/cache and serialized-payload byte-budget eviction, declared and streamed oversized response rejection for connector and health reads, Vayu validation, Cascade evidence rules, route boundaries, durable mission state/evidence/restart, a separately spawned worker process, worker-supervisor crash/restart/backoff/IPC shutdown, atomic worker status and missing/fresh/stale/corrupt handling, backoff-aware scheduled restart visibility, degraded health readiness, worker-side ClearSky and Vayu reads with schema validation, aggregate/PM2.5 projection and privacy omission, provenance and dependent report, memory-gate claim requirements and freshness, encrypted retrieval-audit persistence and restart, migration with plaintext-source preservation, corrupt-ciphertext fail-closed behavior, memory migration/scope/version/backup/corruption/encryption/rotation/concurrency, MCP read-only behavior, and normalized privacy limits. No production vault is used.

Frontend Vitest covers portable encrypted backup confidentiality, authenticated decryption, wrong-passphrase/tamper/weak-passphrase rejection, typed mission planning labels, and preservation of degraded gateway health diagnostics. ESLint includes React Hooks rules. The production build performs `tsc --noEmit` before Vite.

## Browser checks performed

Using Playwright CLI against the `start.ps1` launcher: created a durable mission, validated it, passed the memory gate, queued it, observed the separately spawned worker complete the deterministic task chain, inspected/exported the report, reloaded, and confirmed the server-side mission remained. The current source APIs were unavailable and surfaced as disconnected/simulated. Width checks at 390, 768 and 1440 pixels had no document-level overflow. A page-level timeline overflow discovered at 390 px was fixed. The normal smoke produced zero browser console errors/warnings.

This was a manual CLI smoke, not a committed automated Playwright test suite. Keyboard coverage is limited to the already-present command palette flow from prior project verification. No automated axe/accessibility, reduced-motion, low-bandwidth, or mobile device emulation suite was run in this Genesis pass.

## Current central result (2026-10-22)

- Gateway: 80 passed, 0 failed, 0 skipped.
- Frontend lint: pass.
- Frontend unit tests: 8 passed in 3 files.
- TypeScript check and production bundle: pass.
- Globe3D chunk: 553.57 kB minified (138.68 kB gzip), still over Vite's 500 kB advisory limit.

The full workspace includes specialist projects with their own toolchains and optional dependencies. Their historical results and blockers are separately recorded in `TEST_RESULTS.md`; they were not rerun as part of this current central check.
