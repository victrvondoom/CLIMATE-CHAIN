# Verification results

Updated: 2026-10-21

| Check | Result | Scope and limits |
|---|---|---|
| climate-chain/gateway npm test | PASS: 14 tests | Cascade domain checks, Teesri privacy normalization, unknown Clearsky outcomes and local HTTP integration against deterministic fixtures; no external API access |
| climate-chain/frontend npm run build | PASS | TypeScript and Vite production build; Three.js is a lazy-loaded 553 kB minified chunk |
| Rantai source secret inspection | PASS for source remediation | Credential literals removed from upload route and use is environment-backed; this does not rotate previously exposed provider credentials |
| Rantai TypeScript | PASS | `pnpm exec tsc --noEmit`; fixed the Next route export, async cookies API, parser typing, JSX compatibility, chart child typing and contract method typings |
| Rantai production build | PASS | `pnpm install --frozen-lockfile` followed by `pnpm run build` with Next build-time type validation enabled |
| Rantai standalone lint script | PASS WITH WARNINGS | Added an ESLint config and direct lint command; 0 errors and 2 warnings (missing hook dependency, remote profile `<img>`) |
| Rantai write-failure behavior | Source changed | Fake hashes/IDs replaced by errors and production build passes; focused runtime failure tests are still absent |
| Climate Chain one-command launcher | PASS | `climate-chain/start.ps1` built the frontend, started the local gateway and returned the simulated Cascade fixture as non-candidate |
| Climate Chain browser workflow | PASS WITH EXPECTED SOURCE ERROR | Direct navigation, local simulated walkthrough, manifest download and 390 px viewport; local upstreams were deliberately unreachable and produced a visible 502 error state |
| Repository Python syntax scan | PASS | Parsed 589 Python files with UTF-8 BOM support; 0 syntax errors |
| Teesri Shikayat tests | PASS: 66 tests | Added explicit UTF-8 reads for bundled clinic/grid JSON and console HTML; prevents Windows code-page failures |
| JunkSnap frontend | PASS: 1,259 tests | TypeScript and Vite production build pass |
| JunkSnap server | PASS: 2,296 tests | Typecheck and TypeScript build pass |
| Clearsky dashboard | PASS: 27 tests | Typecheck and Vite production build pass; Clearsky backend suite not run |
| Vayu | PASS: 1,285 tests | Workspace typecheck, lint and web build pass; fixed the fire-count response assertion |
| CarbonShield | PASS: 308 tests, 11 skipped | 37 warnings; `web3` is declared, local `eth-tester` imports are deferred, and the raw-source comparison skips when the excluded source CSV is absent |
| CarbonTwin | PASS: 11 tests | `npm test` now compiles the Solidity artifact before running tests; Vite build passes |
| Grounded | PASS: 250 tests | Workspace typechecks and tests pass across protocol, simulation, world, web and server packages |
| PLUME frontend | PASS | TypeScript, ESLint and Next production build pass |
| Rantai | PASS | TypeScript, standalone ESLint and Next production build pass; two ESLint warnings remain |
| Other specialist suites | NOT RUN | CarbonLens, ecograph, AquaQuest, Clearsky backend, JunkSnap ML and PLUME backend remain outside this check run |
| npm dependency audits | FINDINGS | Vayu reports 8 vulnerabilities (5 moderate, 1 high, 2 critical); PLUME frontend reports 6 (5 high, 1 critical). Available fixes require major upgrades, so no forced dependency migration was applied |
| Live upstream endpoints | NOT VERIFIED | No public request was made in the integration test |
| Deployments, transactions, notifications | NOT RUN | No external state-changing actions were performed |

## Test cases added

- Eligible observed site/monitor pair produces a human-review proximity lead.
- Model/simulated air, stale/missing timestamps, closed sites and distance threshold failure do not create candidates.
- Geographic coordinate and threshold bounds are checked.
- Manifest canonicalization is deterministic and content changes alter the digest.
- API route validates site ID/thresholds, rejects writes and returns source provenance through a real local HTTP request.
- Local simulated walkthrough makes no upstream request; a live-source failure returns an error without a success-shaped mock result.
- Teesri normalizer and proxy omit household IDs, labels, messages and coordinates while preserving aggregate status counts.
- Existing source proxy routes forward methods and user authorization to deterministic fixtures; the proxy does not add source credentials.
- Teesri bundled UTF-8 files load under the Windows default code page; Vayu's fires question matcher accepts the existing satellite-count answer; CarbonTwin's test command builds its generated contract artifact first.
- CarbonShield declares the Web3 runtime dependency and keeps the test-only in-process EVM imports local to its development chain; raw-data reconciliation is explicitly skipped when the ignored source CSV is unavailable.
