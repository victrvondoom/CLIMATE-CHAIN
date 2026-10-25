# Implementation status

Updated: 2026-10-21

## Completed in this execution

- Audited the 12 specialist source boundaries and current central runtime with three independent read-only audits plus local source inspection.
- Added docs/audit/REPOSITORY_AUDIT.md, MODULE_CAPABILITY_MATRIX.md and the machine-readable 240-item backlog.
- Added a read-only GET /api/v1/cascade route for an open DumpWatch site and a nearest AirPulse monitor response.
- Added bounded distance/time thresholds, separate source timestamps and modes, monitor provenance, explicit uncertainty/status, and no-causality wording.
- Added a canonical SHA-256 downloadable evidence manifest with the limitation visible in API response and UI.
- Added a central Cascade Review page, accessible threshold controls, loading/error/retry states, provenance detail and a 3D place lens. It hands off to DumpWatch for any action.
- Added direct sidebar navigation with an open-site selector and a separately labeled local walkthrough; the place lens marks only the selected review site and query point.
- Added `climate-chain/start.ps1` so one command builds the frontend and starts the unified gateway after the first dependency install.
- Removed unsupported cross-city/cause-effect claims from the overview feed and labeled the overview's decorative pilot arcs.
- Reduced TapAlert data to aggregate household status counts before it enters the shared overview or state route; source passthrough retains its existing method and authorization behavior.
- Removed hardcoded Pinata credential literals from the SupplyTrail upload route, moved the JWT to server environment configuration, made unconfigured uploads return 503 and stopped logging provider error bodies.
- Replaced fake transaction hashes/proposal IDs on SupplyTrail write failures with errors handled by existing UI failure paths.
- Fixed Windows UTF-8 reads in TapAlert, made UniqueCredit tests build their Solidity artifact first, repaired the SinkGuard local-chain import/test setup and corrected AirPulse's fire-count test matcher.
- Added a working standalone ESLint setup to SupplyTrail and corrected the SinkGuard smoke-script entry point so it delegates to the maintained deploy-and-verify flow.

## Verification

- Gateway test command: npm test in climate-chain/gateway — 14 passing, including demo isolation, live-source failure behavior, TapAlert aggregate redaction and local HTTP integration.
- Frontend production build: npm run build in climate-chain/frontend — TypeScript and Vite build pass; Three.js remains a separate 553 kB minified chunk.
- SupplyTrail dependencies installed with `pnpm install --frozen-lockfile`; `pnpm exec tsc --noEmit` and `pnpm run build` pass with type validation enabled.
- Browser workflow: direct sidebar entry, live-source unavailable state, explicit simulated walkthrough, manifest download and a 390 px viewport pass with no horizontal overflow. The browser console's only error was the intentionally unavailable local live-source request; the walkthrough loaded without warnings.
- One-command launcher smoke check: start script built the UI, served the gateway on localhost, and returned the local demo as `candidate: false`.
- SupplyTrail standalone lint now exits successfully with two warnings; Next.js build also passes with build-time type validation.
- Additional specialist verification: TapAlert 66 tests; DumpWatch 1,259 frontend + 2,296 backend tests; AshAlert dashboard 27 tests; AirPulse 1,285 tests; SinkGuard 308 passed/11 skipped; UniqueCredit 11; Grounded 250; MethaneMend frontend typecheck/lint/build. See `VERIFICATION_RESULTS.md` for details and limits.
- Python syntax scan parsed 589 files with zero errors. CarbonScope, ImpactGraph, BlueTrail, AshAlert backend, DumpWatch ML and MethaneMend backend suites remain unverified.
- `npm audit` reports 8 vulnerabilities for AirPulse and 6 for MethaneMend frontend; available fixes require major dependency upgrades and were not forced into this check run.
- Gateway integration test uses deterministic local HTTP fixtures. No hosted API was called, so production freshness, availability, credentials and response drift remain unverified.

## Partial or not done

- No shared persistence, identity/roles, canonical incident database, central intervention state machine, chain-of-custody ledger or independently immutable audit service.
- Only four civic APIs are connected; Cascade currently uses two. The other eight specialist APIs/data stores are not normalized into the gateway.
- Carbon, methane and energy integrations remain source-specific backlog work.
- No all-project baseline test pass, external live API check, deployment, cloud provisioning or cost review.
- Prior Pinata values must be revoked/rotated by an authorized operator; changing source does not invalidate a credential already copied elsewhere.
