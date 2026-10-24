# Recovery audit: blockchain and environmental-evidence mission

What the repository held before this work, what was missing, every file changed, and how to undo each change without losing other uncommitted work.

## Snapshot at the start

| Item | Value |
|---|---|
| Branch | `merge/one-app` |
| Working tree | 88 status entries: 47 modified tracked files and 41 untracked paths, all uncommitted and preserved |
| Commits made by this work | None |
| Running processes left alone | The launcher's Hardhat node (port 18545) and gateway (port 8080), both still on the code from before this work |

### Baseline tests before any change

| Suite | Command | Result |
|---|---|---|
| Frontend types | `npx tsc --noEmit` (frontend) | Pass |
| Frontend tests | `npx vitest run` (frontend) | 69 files, 489 tests, all pass |
| Frontend lint (dashboard scope) | `npx eslint src/dashboard src/App.tsx` | Pass |
| Gateway tests | `npm test` (gateway) | 134 tests, all pass |
| Contract tests | `npx hardhat test` (blockchain) | 3 passing |

These matched the figures reported after the dashboard merge, so there was no drift.

## Blockchain inventory found

- `blockchain/`: a Hardhat 2.28 project with `EvidenceAnchor.sol` (anchors Cascade Review digests; rejects empty and duplicate digests), its 3 tests, and `deploy.js`.
- `gateway/evidence-anchor.mjs`: local-only anchoring and verification for Cascade manifests, with chain ID and loopback checks, served at `/api/v1/evidence-anchors`.
- `start.ps1`: starts the chain on 18545, deploys, then starts the gateway.

## What was missing

- Evidence ids, revision lineage and role-based writers on-chain.
- A claim registry with duplicate protection, challenge and correction.
- An environmental source adapter that keeps raw bytes and provenance for hashing.
- A typed evidence bundle and claim schema.
- A user-facing flow that shows the transaction, an independent check, a tamper failure, a replay rejection and a duplicate-claim rejection.
- A browser verifier that does not rely on the gateway.

All of these were added. `EvidenceAnchor` and its API were left as they were.

## Files added

| File | Purpose |
|---|---|
| `blockchain/contracts/EnvironmentalEvidenceRegistry.sol` | Evidence registry with attester role and parent links |
| `blockchain/contracts/ClimateClaimRegistry.sol` | Claim registry with exclusivity and evidence locks, challenge and correction |
| `blockchain/test/IntegrityRegistries.test.js` | 16 contract tests |
| `gateway/integrity-evidence.mjs` | Canonical JSON, SHA-256, analyte catalogue, bundle, claim, challenge, tamper copy and recommendations |
| `gateway/integrity-sources.mjs` | Open-Meteo adapter with failure states and cached fallback |
| `gateway/integrity-service.mjs` | Chain calls, off-chain store and lab workflow |
| `gateway/fixtures/integrity/*.json` | Two captured Open-Meteo responses and the shared canonical-hash vector |
| `gateway/tests/integrity.test.mjs`, `integrity-routes.test.mjs`, `integrity-e2e.test.mjs` | Unit, route and opt-in end-to-end tests |
| `frontend/src/integrity/api.ts`, `verify.ts`, `verify.test.ts` | Typed client, browser verifier and its tests |
| `frontend/src/modules/IntegrityLab.tsx`, `integrity.css` | The lab page |
| `frontend/src/modules/ModuleScreen.test.tsx` | Guards the duplicate-key fix |
| `docs/blockchain-integrity.md`, `data-sources.md`, `demo-script-5min.md`, `final-verification.md`, this file | Documentation |
| `.env.example` | Environment variable names, placeholders only |

To roll back an added file, delete it. Nothing else depends on these files except the edits listed below.

## Files edited

Several of these already held uncommitted changes from earlier work. Do **not** use `git checkout -- <file>` to undo this work: that would also discard the earlier changes. Revert only the edits described here.

| File | Edit | To undo |
|---|---|---|
| `blockchain/scripts/deploy.js` | Calls a new `deployIntegrityRegistries` after the existing deployment. It honours `CLIMATE_CHAIN_DEPLOYMENTS_DIR` and logs the real output paths. | Remove that function and its call, restore `const dir = path.join(__dirname, '..', 'deployments')`, and restore the two `console.log` lines |
| `gateway/gateway.mjs` | Imports `createIntegrityService`; adds `handleIntegrity`, `routeIntegrity` and `readOptionalJsonBody`; an `integrityService` option; one route dispatch | Remove those additions |
| `.gitignore` | Ignores `blockchain/deployments/integrity-localhost.json` and `gateway/.integrity-data/` | Remove the two lines |
| `frontend/src/data/capabilities.ts` | Adds `'integrity'` to `WorkspaceView` | Remove the union member |
| `frontend/src/dashboard/library.ts`, `library.test.ts` | Registers the lab in the Evidence group, plus one test | Remove the entry and the test |
| `frontend/src/dashboard/Dashboard.tsx` | Opens the module group when the open view is a module, which the dashboard doc already promised | Restore `useState(false)` for `modulesOpen` |
| `frontend/src/App.tsx` | Lazy-loads `IntegrityLab`, adds the `integrity` case, passes `onIntegrity` to the Command center | Remove the three additions |
| `frontend/src/modules/Overview.tsx` | Optional `onIntegrity` prop and one hero link | Remove the prop and the button |
| `frontend/src/components/CommandPalette.tsx` | One `integrity` command | Remove the line |
| `frontend/src/modules/ModuleScreen.tsx` | Gives the page boundary and evidence panel distinct keys (`<id>:page`, `<id>:evidence`) | Restore `key={climateModule.id}` on both, which brings back the warning |
| `frontend/vite.config.ts` | The `/api` proxy target can be overridden with `CLIMATE_CHAIN_GATEWAY_URL` (default unchanged) | Restore the literal `'http://127.0.0.1:8080'` |
| `README.md` | Lab section, configuration rows, verification commands, and the corrected Boundaries and Start sentences | Remove the lab section and rows; restore the two sentences |
| `docs/dashboard-consolidation.md` | Removed an audience line that belonged in a chat message, not the doc | Optional |

## The Vayu duplicate-key warning

The earlier report placed it near `vayu/module.tsx:203`. The React stack trace shows the real cause: `ModuleScreen.tsx` gave two sibling elements the same key (`climateModule.id`), so every native module page logged it, not only Vayu. Two keys were changed in `ModuleScreen.tsx`. `vayu/module.tsx` and its uncommitted edits were not touched. A new test failed before the fix (`junksnap keys: junksnap, junksnap`) and passes after. A fresh browser load of `#module:vayu` logged the warning 6 times before the fix and 0 times after.

## Tools used and not used

| Tool | Status |
|---|---|
| `/autoplan` | Not run. Its full pipeline needs outside reviewers and ends at an approval gate. |
| `/office-hours` | Not run. It is interactive, and no blocking product question came up. |
| `/ecc:go-build` | Not run. It builds Go code, and this repository has none in scope. |
| ECC review agents | Not run. No subagents were started. |
| HawkScan DAST | Not run. `HAWK_API_KEY` is not set. |
| Chrome DevTools browser automation | Used for the browser checks. The Claude-in-Chrome extension was not connected. |
| Firecrawl | Used to read the Open-Meteo documentation and check the WHO guideline values |
