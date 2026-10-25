# Final verification · IEEE Climate Chain 2026

Run on 2026-10-23 on Windows with Node.js 24.14.0. The repository already had substantial uncommitted work before this final audit; those changes were preserved. Nothing was committed or published.

## Release status

**Local IEEE hackathon demo: ready. Public production release: not ready.**

The app is running at [http://127.0.0.1:8080](http://127.0.0.1:8080). The launcher’s current chain is a local Hardhat EVM, chain ID 31337, at `127.0.0.1:18545`. Current proof transactions and contract addresses are recorded below, but the launcher recreates this chain on restart.

## Automated checks

| Area | Command | Result |
|---|---|---|
| Frontend types | `npx tsc --noEmit` in `frontend` | Pass |
| Frontend unit/component tests | `npx vitest run` in `frontend` | Passed on 2026-10-23 (run npm test for current counts) |
| Frontend lint | `npm run lint` in `frontend` | Pass |
| Frontend production build | `npm run build` in `frontend` | Pass; large-chunk warnings remain |
| Gateway suite | `npm test` in `gateway` | Passed with 0 failed; 1 opt-in test skipped on 2026-10-23 (run npm test for current counts) |
| On-chain journey | `CLIMATE_CHAIN_E2E=1 node --test tests/integrity-e2e.test.mjs` in `gateway`, against the running local chain | 1 passed; covers evidence, anchor, verify, tamper, replay, claim, duplicate, challenge and correction |
| Solidity contracts | `npx hardhat test` in `blockchain` | Passed (19 tests on 2026-10-23; run npm test for current counts) |
| Browser route audit | Playwright on the running app | 32/32 dashboard destinations rendered |
| Four-panel/browser performance sample | Playwright at 1440×1000 | Four panels rendered; two Cesium viewers; 60.2 mean frames/s and 16.8 ms p95 frame spacing over 5 seconds; 45.9 MB Chromium JS heap at measurement time |

The production build still warns that the lazy Cesium chunk is about 4,182.82 kB (1,122.80 kB gzip) and the main chunk about 971.50 kB (252.85 kB gzip). The Earth view is lazy-loaded and the four-panel browser sample completed, but bundle splitting is still a follow-up.

## Route, interaction and runtime verification

The route sweep covered all 14 core views and 18 native module destinations. Five lazy core routes were allowed to finish loading before they were counted. The route sweep recorded no route-level page errors or HTTP 5xx.

The browser checks exercised search-to-route, the command palette, back/forward navigation, pinning, saved pins after reload, the mobile menu, and retry after a deliberately interrupted overview request. Widths 390, 768 and 1440 px did not create horizontal overflow. On Earth, the clock paused after the control settled, the 3600× setting advanced about an hour per second, and restoring 1× returned to real-time progression. Clicking the globe changed the selected coordinates and solar readout. The panel exposes solar azimuth, altitude, subsolar point, polar daylight and apparent solar time. Cesium lighting follows its simulation clock; the readout uses NOAA’s approximate geometric equations for the Sun’s centre, without local terrain or atmospheric refraction. The four-panel sample mounted Command center, Satellite climate globe, Unified mission studio and Climate Integrity Lab; switching to the mission path released both Cesium viewers/canvases. Current dedicated listeners saw zero page errors and zero HTTP 5xx during the Integrity Lab, Cascade, Earth and four-panel runs.

Browser evidence: [four-panel view](../output/playwright/final-mission/four-panel-1440.png), [solar globe interaction](../output/playwright/final-mission/earth-solar-1440.png), [Integrity Lab proof](../output/playwright/final-mission/integrity-proof-1440.png), [Cascade manifest proof](../output/playwright/final-mission/cascade-chain-proof-1440.png).

The long-lived Playwright session still displays a cumulative console count from earlier stale-server checks and deliberate launcher restarts. That includes the pre-fix memory-vault 503 and connection errors while the old process was stopped; it is not the result of the current flows. After the DPAPI parser fix (a unique marked PowerShell result, parsed fail-closed) and launcher restart, its focused crypto suite passed all 6 tests, including real Windows DPAPI protect/decrypt/rotation; six memory API/UI reads returned HTTP 200 and the memory status showed READY.

The active memory vault reports AES-256-GCM with a Windows DPAPI-protected key. The health endpoint also warns that legacy plaintext vault and retrieval-audit copies remain for reversible migration. They were left intact; review them under the host’s retention policy before adding sensitive memories.

## Live-source snapshot and Cascade result

At 2026-10-23 14:37 UTC, the shared overview reported DumpWatch, AshAlert, TapAlert and AirPulse as live. This is a time-bounded observation, not a source uptime guarantee.

The subsequent Cascade request for public DumpWatch site `site_01m4nvbn53xk778xb83n75szdx` also returned HTTP 200 from both adapters. AirPulse returned PM2.5 23.5 µg/m³ with **model** provenance; the site’s last report was more than 11 days old. The review correctly returned `source_not_observed`, `candidate: false`, and evidence coverage 0/3. It did not invent a monitor distance, classify a lead, or claim causality.

## Blockchain evidence visible in the app

The two local-chain flows have different, project-specific purposes:

1. **Cascade manifest integrity:** the app anchored the exact current Cascade manifest, including its explicit non-candidate result. The UI reported proof verified on chain 31337, block 27. Transaction: `0xf31a890cccce8dbf3222800f3d6c21eb689583e788d7a1d65cef7caa3632a1b7`. Digest: `0x8420988c5d527f67252b1d0b49db6da30f2d3bed2a63da01645bf6a711f5eb20`. A separate gateway lookup returned `proofVerified: true`.
2. **Climate Integrity Lab evidence and claims:** the live-only Chennai PM10 model bundle was anchored in `EnvironmentalEvidenceRegistry` at block 20 with receipt status 1. Transaction: `0xe1cc3b498e48d2807f3c14d8caf2f8792a8d9a8cc0be9633ee00b3870884a944`. Digest: `0x5e29ec43009d2d268edd2f56ffae95e96b1b661ae067a7f4a83f8701da8b17ab`. The browser re-hashed the bundle and read the same digest directly from the RPC. A 0.1 value change produced a different digest; replay reverted with `EvidenceIdTaken` at block 21. The demo claim was submitted at block 22, challenged at block 24 and corrected through new linked records at blocks 25–26. The original evidence and claim remain as superseded records.

The UI labels CAMS values **MODEL FORECAST** (approximately 45 km grid, not a monitor reading) and labels claims **DEMO / NOT A CERTIFIED CREDIT**. The digest proves byte consistency against this local chain; it does not prove a model is correct, a measurement was observed, a site caused a reading, or a climate outcome occurred. Hardhat actors are local test accounts, not independent reviewers.

## Dependency and security review

`npm audit --json` reported:

| Workspace | Findings |
|---|---|
| `frontend` | 0 |
| `gateway` | 0 |
| `blockchain` development toolchain | 19 advisories: 8 high, 2 moderate, 9 low |

The blockchain findings are in the local build/test toolchain rather than the running gateway. npm reports that the Hardhat remediation requires a major upgrade to Hardhat 3.21.0; it also recommends a solc change that conflicts with the repository’s Solidity 0.8 build. No broad major upgrade or compiler downgrade was applied because it could break the verified local chain workflow. Resolve these findings before publishing or using the toolchain beyond the hackathon demo.

The `.env` and `.env.*` patterns are ignored except the tracked example templates; no env file is tracked. A scoped search found no private-key values in the reviewed changed sources/docs/bundle. HawkScan and the optional `gstack`, `autoplan` and `office-hours` commands were unavailable, and `HAWK_API_KEY` was not configured, so no HawkScan or external review-agent run is claimed.

## Known limits

- No testnet or public-chain deployment was performed. The local Hardhat chain and receipts reset when `start.ps1` restarts it.
- The local memory service still reports retained plaintext migration/audit copies, despite the active encrypted vault. Review those copies before storing sensitive content.
- OpenAQ is not configured; the workspace does not provide a second observed station comparison.
- Current live Cascade data was incomplete, so the actual result was not a candidate. The coverage score is evidence availability, not accuracy, impact or causality.
- The specialist modules are launch points and local demonstrations. Several are simulated or research tools; see the [32-destination capability matrix](final-capability-matrix.md).
- The large Cesium build chunk remains a performance follow-up.

## Reproduce the checks

Run from the repository root in PowerShell:

```powershell
Push-Location frontend
npx tsc --noEmit
npx vitest run
npm run lint
npm run build
Pop-Location

Push-Location gateway
npm test
$env:CLIMATE_CHAIN_E2E = '1'
$env:CLIMATE_CHAIN_RPC_URL = 'http://127.0.0.1:18545'
$env:CLIMATE_CHAIN_INTEGRITY_DEPLOYMENT = (Resolve-Path ..\blockchain\deployments\integrity-localhost.json).Path
$env:CLIMATE_CHAIN_INTEGRITY_DATA = Join-Path $env:TEMP 'climate-chain-e2e-repro'
node --test tests/integrity-e2e.test.mjs
Pop-Location

Push-Location blockchain
npx hardhat test
Pop-Location
```

For a guided live demonstration and current transaction references, see [the final demo script](final-demo-script.md). The current visual evidence is saved under `output/playwright/final-mission/`.

## Final pass: Command center, shared place and health route (2026-10-23)

This pass changed the Command center, carried the air location into Earth and the Integrity Lab, and fixed the health route that browsers logged as failures. It was checked against a relaunched `start.ps1`.

### What changed

- **Command center.** `frontend/src/modules/CommandStatus.tsx` adds "Start here", four workflows that each open a working view, and "Connected now": the local chain, the four sources with LIVE or SIMULATED labels, and what OBSERVED, MODEL FORECAST and NATIVE MODULES mean.
- **Dashboard.** The library folds to a search field and an "All 32 views" toggle below 900 px. The "Show the four signal views side by side" action sends a pin request that the dashboard applies as a grid of Air, Water, Fire and Waste.
- **Shared place.** The topbar air location now opens Earth intelligence on that city, and selects the Integrity Lab site when one matches. Only New Delhi is an Integrity site, so Jodhpur and Chandigarh keep New Delhi.
- **Health route.** The app's readiness probe `/api/health` returns 503 while the mission worker or memory vault is not ready. The dashboard polls it every few seconds, so each degraded poll was logged as a failed browser request. The app now polls `/api/status`, which returns the same body with 200. `/api/health` is unchanged for monitors. The gateway test covers both routes.
- **Docs.** `docs/final-demo-script.md` was rewritten for the final labels. `README.md` has a short section that links the demo, the matrix, the verification record and the audit script. `scripts/browser-audit.mjs` is new.

### Results

| Check | Result |
|---|---|
| Frontend typecheck (`npx tsc --noEmit`) | Pass |
| Frontend tests (`npx vitest run`) | Passed on 2026-10-24 (counts differ between documents; run npm test for current counts) |
| Frontend lint (`npm run lint`) | Pass |
| Gateway tests (`npm test`) | Passed, 1 opt-in skipped, 0 failed on the last recorded run (counts changed between runs and differ from other documents; run npm test for current counts). |
| Contracts (`npx hardhat test`) | Passed (19 tests when recorded; run npm test for current counts) |
| Fresh-chain verification on 18546, twice | 32 of 32 checks passed each time, plus the opt-in end-to-end test. Checks include role boundaries: a claimant cannot anchor (`NotAttester`), a challenger cannot submit a claim (`NotClaimant`), a claimant cannot resolve a challenge (`NotReviewer`), and a claimant cannot add an attester (`NotAdmin`). The end-to-end test ran against that fresh chain both times. |
| Dependency audit, production dependencies (`npm audit --omit=dev`) | gateway 0, frontend 0, blockchain 0. The 19 advisories in the blockchain development toolchain recorded above come from dev dependencies. |
| Full browser audit on the relaunched app | 96 page loads, detailed in the capability matrix |
| Secret scan over 408 tracked and non-ignored files | No private key or `.env` value found. The credential-shaped strings are fixtures in `gateway/tests/knowledge-index.test.mjs` that the redaction test removes. No tracked `.env` files. No local absolute paths in tracked or new files. |

### Transient failures

These showed up in some runs and not in clean reruns. They are recorded here rather than explained away.

- **`GET /api/agent-memory` returned 503 once** during an audit run, on TorchSight at 390 px. The route answers 503 with a stop message when the local vault's sandbox fails. The launcher's logs from earlier runs show two DPAPI failures: "Windows DPAPI could not protect or unlock the local memory key" and "Windows DPAPI returned an invalid key envelope". The DPAPI helper starts a fresh `powershell.exe` for each unlock and has no cache. A cold start on this machine takes about 0.3 s, so a plain 10-second timeout is unlikely to be the cause. The helper's error does not record the child's exit code or stderr, so the cause is not confirmed. Thirty consecutive requests afterwards returned 200. The next step is to log the child's exit status and a short stderr excerpt, without any key material, in `gateway/memory-crypto.mjs`. That file belongs to the vault's owner, so this pass made no change to it.
- **Earth intelligence at 390 px** logged six `ERR_FAILED` requests for Esri satellite tiles, and clean reruns did not. This is third-party tile traffic.
- **Guided mission path at 390 px** stayed on its lazy-load fallback for 34 seconds once. Two reruns loaded in about 4 seconds.
- **`GET /` returned 404 once** while a second `start.ps1` rebuilt `frontend/dist`. The build empties the folder before it writes the new files. Running two launchers at once causes this.

### Not done in this pass

- **Release commit.** None made. Other sessions edited this working tree during the pass: `registry/projects.json`, the feature-catalogue files and `docs/final-capability-matrix.md`. A commit now would capture their in-progress work, so it needs an owner's decision.
- **HawkScan.** Not run. Docker is not running, and `HAWK_API_KEY` is not set.
- **Interactive checks.** Each destination was loaded and checked for errors at three widths. Per-control clicks and data correctness were checked only for the workflows already listed above.
- **Clean-clone test.** Not run in this pass.
- **Publishing.** Nothing was pushed or submitted. The Devpost submission and the GitHub publication need an explicit go-ahead.
