# Verification results

Updated: 2026-10-21

| Check | Result | Scope and limits |
|---|---|---|
| climate-chain/gateway npm test | PASS: 14 tests | Cascade domain checks, TapAlert privacy normalization, unknown AshAlert outcomes and local HTTP integration against deterministic fixtures; no external API access |
| climate-chain/frontend npm run build | PASS | TypeScript and Vite production build; Three.js is a lazy-loaded 553 kB minified chunk |
| SupplyTrail source secret inspection | PASS for source remediation | Credential literals removed from upload route and use is environment-backed; this does not rotate previously exposed provider credentials |
| SupplyTrail TypeScript | PASS | `pnpm exec tsc --noEmit`; fixed the Next route export, async cookies API, parser typing, JSX compatibility, chart child typing and contract method typings |
| SupplyTrail production build | PASS | `pnpm install --frozen-lockfile` followed by `pnpm run build` with Next build-time type validation enabled |
| SupplyTrail standalone lint script | PASS WITH WARNINGS | Added an ESLint config and direct lint command; 0 errors and 2 warnings (missing hook dependency, remote profile `<img>`) |
| SupplyTrail write-failure behavior | Source changed | Fake hashes/IDs replaced by errors and production build passes; focused runtime failure tests are still absent |
| Climate Chain one-command launcher | PASS | `climate-chain/start.ps1` built the frontend, started the local gateway and returned the simulated Cascade fixture as non-candidate |
| Climate Chain browser workflow | PASS WITH EXPECTED SOURCE ERROR | Direct navigation, local simulated walkthrough, manifest download and 390 px viewport; local upstreams were deliberately unreachable and produced a visible 502 error state |
| Repository Python syntax scan | PASS | Parsed 589 Python files with UTF-8 BOM support; 0 syntax errors |
| TapAlert tests | PASS: 66 tests | Added explicit UTF-8 reads for bundled clinic/grid JSON and console HTML; prevents Windows code-page failures |
| DumpWatch frontend | PASS: 1,259 tests | TypeScript and Vite production build pass |
| DumpWatch server | PASS: 2,296 tests | Typecheck and TypeScript build pass |
| AshAlert dashboard | PASS: 27 tests | Typecheck and Vite production build pass; AshAlert backend suite not run |
| AirPulse | PASS: 1,285 tests | Workspace typecheck, lint and web build pass; fixed the fire-count response assertion |
| SinkGuard | PASS: 308 tests, 11 skipped | 37 warnings; `web3` is declared, local `eth-tester` imports are deferred, and the raw-source comparison skips when the excluded source CSV is absent |
| UniqueCredit | PASS: 11 tests | `npm test` now compiles the Solidity artifact before running tests; Vite build passes |
| Grounded | PASS: 250 tests | Workspace typechecks and tests pass across protocol, simulation, world, web and server packages |
| MethaneMend frontend | PASS | TypeScript, ESLint and Next production build pass |
| SupplyTrail | PASS | TypeScript, standalone ESLint and Next production build pass; two ESLint warnings remain |
| Other specialist suites | NOT RUN | CarbonScope, ImpactGraph, BlueTrail, AshAlert backend, DumpWatch ML and MethaneMend backend remain outside this check run |
| npm dependency audits | FINDINGS | AirPulse reports 8 vulnerabilities (5 moderate, 1 high, 2 critical); MethaneMend frontend reports 6 (5 high, 1 critical). Available fixes require major upgrades, so no forced dependency migration was applied |
| Live upstream endpoints | NOT VERIFIED | No public request was made in the integration test |
| Deployments, transactions, notifications | NOT RUN | No external state-changing actions were performed |

## Test cases added

- Eligible observed site/monitor pair produces a human-review proximity lead.
- Model/simulated air, stale/missing timestamps, closed sites and distance threshold failure do not create candidates.
- Geographic coordinate and threshold bounds are checked.
- Manifest canonicalization is deterministic and content changes alter the digest.
- API route validates site ID/thresholds, rejects writes and returns source provenance through a real local HTTP request.
- Local simulated walkthrough makes no upstream request; a live-source failure returns an error without a success-shaped mock result.
- TapAlert normalizer and proxy omit household IDs, labels, messages and coordinates while preserving aggregate status counts.
- Existing source proxy routes forward methods and user authorization to deterministic fixtures; the proxy does not add source credentials.
- TapAlert bundled UTF-8 files load under the Windows default code page; AirPulse's fires question matcher accepts the existing satellite-count answer; UniqueCredit's test command builds its generated contract artifact first.
- SinkGuard declares the Web3 runtime dependency and keeps the test-only in-process EVM imports local to its development chain; raw-data reconciliation is explicitly skipped when the ignored source CSV is unavailable.
