# Test Results

**Current central verification:** 2026-10-22. The central results below were rerun after Genesis changes. Specialist project results are historical workspace audit results and were not rerun in this pass.

## Central Climate Chain

| Area | Command or flow | Result |
|---|---|---|
| Frontend build | `npm run build` from `climate-chain/frontend` | Pass; TypeScript and Vite succeeded. Globe3D lazy chunk: 553.57 kB minified / 138.68 kB gzip; main chunk: 310.27 kB / 94.80 kB gzip. The Globe3D chunk still triggers the 500 kB advisory. |
| Frontend lint | `npm run lint` from `climate-chain/frontend` | Pass with ESLint and React Hooks rules. |
| Frontend unit tests | `npm test` from `climate-chain/frontend` | **8 passed** in 3 Vitest files. |
| Frontend typecheck | `npm run typecheck` from `climate-chain/frontend` | Pass; also runs in the production build. |
| Gateway final | `npm test` from `climate-chain/gateway` | **80 passed, 0 failed, 0 skipped.** Includes connector response-size enforcement for declared and streamed bodies (including health checks), cache byte-budget eviction, worker liveness (missing/fresh/stale/corrupt and backoff-aware restart state), separate worker process and supervisor crash/restart/shutdown, degraded health readiness, encrypted retrieval audit migration and corruption handling, memory-gate persistence/evidence/recovery, local AshAlert and AirPulse worker reads with aggregate/PM2.5 privacy projections and provenance, local read-only/CORS boundary, memory encryption/integrity/concurrency, and MCP tests. |
| Node syntax | `node --check gateway.mjs`; `node --check agent-memory.mjs`; `node --check memory-mcp.mjs` | Pass. |
| MCP stdio | Gateway suite exercises JSON-RPC initialization, scoped recall/search and tool listing over stdio | Pass against isolated vaults; suite verifies read-only tools and bounded protocol handling. |
| Memory encryption | Gateway unit/integration tests plus frontend Vitest | Pass for AES-GCM vault and retrieval-audit tamper detection, DPAPI persistence/key rotation, vault/audit migration preservation and portable encrypted backup tamper/wrong-passphrase rejection. |
| Retrieval audit app smoke | Isolated `start.ps1` service on port 8191; read `/api/agent-memory`, searched through `/api/agent-memory/search`, read `/api/agent-memory/retrievals`, and inspected the encrypted file under an isolated memory directory | Pass: status reported vault encryption enabled and no active plaintext vault; one retrieval trace returned; audit file contained neither the query marker nor memory ID in plaintext. Frontend returned HTTP 200 and all launcher child processes exited on Ctrl+C. |
| Durable mission browser flow | Create, validate, pass memory gate, queue, separate worker executes, inspect evidence, export report, reload | Pass via the `start.ps1` launcher against isolated local data; server-side mission remained after reload. A separate isolated HTTP integration test verifies gateway restart persistence. No regular user vault/store was used. |
| Worker connector integration | Spawned worker reads local AshAlert and AirPulse fixtures, schema-validates them, omits unexpected or privacy-sensitive fields, stores provenance, completes a dependent report, and remains available after gateway restart | Pass; fixtures are deterministic and do not establish external upstream availability. |
| Local launcher lifecycle | `start.ps1` built and launched supervisor/worker/gateway on port 8190; `/api/health` returned `ready` with a running worker heartbeat (about 1 second old); static page returned HTTP 200; Ctrl+C stopped all processes without orphans | Pass using isolated temporary memory, mission and worker-status paths. |
| Command palette | Ctrl+K, navigation/memory/mission search, Enter, Tab/Shift+Tab focus loop | Passed in the prior UI smoke; not repeated in the final Genesis run. |
| Failure states | Inject source-status 503 and memory-vault 503 in browser | Passed in the prior UI smoke; not repeated in the final run. |
| Responsive browser | Playwright at 390×844, 768×1024 and 1440×900 on memory and Mission Studio | Pass. Page width matched each viewport; no page-level horizontal overflow. Memory graph uses contained horizontal scrolling on narrow screens. |
| Browser console | Normal mission flow on final build | 0 console errors and 0 warnings. |

The health and encrypted-audit smokes used isolated temporary data and did not use the regular user vault.

## Thirteen capability-set baselines — historical audit

These were audited independently before central implementation and were not rerun in this pass. They do not imply the sibling projects share a runtime or can be centrally executed. See `INTEGRATION_MATRIX.md` for source/dependency details.

| Capability set | Checks and result | Limits |
|---|---|---|
| Climate Chain | Frontend build/typecheck pass; gateway final 27/27 pass; Playwright flows above pass. | No declared frontend lint or unit-test runner. Upstreams were unreachable during the run, so central climate data was labeled simulated. |
| DumpWatch | Web build/lint/tests pass (**1,259 tests**); server build/lint/tests pass (**2,296 passed, 30 skipped**). | Python/ML/crawler/geometry checks not established because optional dependencies including `shapely` and `ward_crawler` were absent. |
| AshAlert | Dashboard build and tests pass (**27 tests**). | No frontend lint script; backend pytest collection blocked by missing `rapidfuzz`. |
| TapAlert | Source inspected; static checks attempted. Ruff reported 20 findings; mypy reported 49. | Pytest unavailable in project environment; system collection blocked by missing `cedarpy` and `strands`. These are not passing tests. |
| AirPulse | Lint, TypeScript check, build and tests pass (**1,285 tests**). | Main JavaScript chunk is about 1.84 MB; source-project performance work remains. |
| BlueTrail | `node --check` passed for 42 JavaScript files. | No manifest/test runner found; syntax checks are not behavior coverage. |
| MethaneMend | Frontend lint/build/typecheck pass; targeted Python checks pass (**23 tests**). | Full pytest collection blocked by missing `geoalchemy2` and `web3`; Foundry unavailable. No contract-test result is claimed. |
| CarbonScope | Project contents inspected; dashboard/source identified. | Static research/demo surface with synthetic cases; dependencies/tests not installed or run. |
| SinkGuard | Global pytest excluding `tests/test_api.py`: **266 passed, 11 skipped**, 28 warnings. | API tests blocked by missing `web3`; UI build/browser checks not run because dependencies were absent. Research-stage measures remain non-production. |
| UniqueCredit | Web tests **11 passed**, Python unittest **14 passed**, project build passed. | Pipeline not run because optional LLM/anchor artifacts were unavailable. |
| ImpactGraph | Source/MCP/demo surfaces inspected. | Tests blocked by incompatible `mcp.Client` usage and missing `redislite`; no pass count claimed. |
| Grounded | `pnpm test`: **250 passed**; typecheck and build pass. | Build warns about large chunks; application is decision support, not grid actuation. |
| SupplyTrail | Lint, TypeScript check and build pass; lint reports two warnings. | No test script. Source URL mismatch and demo/testnet flows prevent a central production-action claim. |

## Evidence boundaries

- The four central source adapters were unreachable in this environment. Fallbacks are marked simulated, and place-based review excludes synthetic/estimated values from evidence candidates.
- No hosted CI, cloud credentials, deployment, Foundry node, or external agent installation was available or exercised.
- Browser speech recognition was not tested with real microphone audio. Transcript editing and review-to-save were exercised; the app sends no audio to the gateway and warns that browser/provider processing may be external.
- Durable mission persistence is local to the gateway OS user-data directory, not team synchronization or cross-device storage. A separate browser-local dry-run also remains available.

