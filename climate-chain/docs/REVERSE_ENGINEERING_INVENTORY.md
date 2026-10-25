# Reverse-engineering inventory — 18 project folders

Written for: the team and reviewers who need to know what each folder does, how it runs, and what was checked. Date: 22 Oct 2026.

## How the merge is done

- **One folder.** All 18 project folders are copied into `climate-chain/projects/` with their original names. Dependency folders (`node_modules`, `.venv`, `.next`, `target`, caches) are excluded. The original folders at the workspace root are untouched.
- **One registry.** `registry/projects.json` lists every project: its folder, stages, features, evidence statement, readiness, live link, and stack. The gateway serves it at `/api/v1/projects`. The frontend builds the capability map from the same file.
- **One origin for standalone apps.** Seven projects ship a static UI that runs without a backend. The gateway serves them under `/apps/<id>/`, and the launchpad checks each one before linking to it.
- **Not a code-level rewrite.** The projects use different languages and chains (Solidity, Rust/Anchor on Solana, Python, Flutter, Next.js, Vite, AWS CDK). Each has its own accounts and secrets. Rewriting them into one codebase would change working code without per-project test coverage, so the merge keeps each project intact and joins them at the registry, gateway, and UI.

## Inventory

| # | Folder (in `projects/`) | Project | Domain | Stack (from manifests) | Mission stages | Runs here as | Live link |
|---|---|---|---|---|---|---|---|
| 1 | `JunkSnap-main` | DumpWatch | Waste · Jodhpur | React/Vite, FastAPI + scikit-learn, AWS (boto3), Tauri Android | sense, verify, act, prove | gateway-live waste source | junksnap.coehemang.dev |
| 2 | `clearsky-main` | AshAlert | Fire · Punjab | React/Vite/Tailwind, AWS Lambda backend | sense, act, prove | gateway-live fire source | clearsky.akkki.tech |
| 3 | `teesri-shikayat-main` | TapAlert | Water · Mumbai | Python, AWS CDK, Lambda, Telegram | sense, verify, act, prove | gateway-live water source | Lambda console URL |
| 4 | `the-vayu-project-main` | AirPulse | Air · Delhi | TS monorepo (api, web, packages), React/Vite, AWS CDK, ESP32 firmware | sense, verify, act, prove | gateway-live air source | cloudfront URL |
| 5 | `AquaQuest-main` | BlueTrail | Water · Bangladesh | Static PWA (HTML/CSS/JS) | sense, act, prove | **`/apps/aquaquest/`** | GitHub Pages |
| 6 | `PLUME-main` | MethaneMend | Methane · Permian | Next.js/React/Tailwind, FastAPI + SQLAlchemy, scikit-learn, Foundry | sense, verify, act, finance, prove | launch point (needs `npm install` + backend) | GitHub Pages snapshot |
| 7 | `carbonlens-main` | CarbonScope | Carbon integrity | Python ML (scikit-learn), Hardhat + Solidity, self-contained HTML | verify, finance, prove | **`/apps/carbonlens/`** (after `build_dashboard.py`) | Claude artifact demo |
| 8 | `carbonshield-main` | SinkGuard | REDD+ research | React/Vite/Tailwind, FastAPI + pandas + scikit-learn, web3 | verify, prove | launch point (needs Python env + build) | GitHub repo |
| 9 | `carbontwin-main` | UniqueCredit | Carbon integrity | Vite build, Python pipeline (pandas, scikit-learn), Node contracts | verify, finance, prove | **`/apps/carbontwin/`** (prebuilt `dist/`) | GitHub Pages |
| 10 | `ecograph-main` | ImpactGraph | Carbon integrity | Python agent + FalkorDB, 11 MCP tools, Flutter app, Render/Docker | verify, prove | **`/apps/ecograph/`** (story page only) | ecograph-790j.onrender.com |
| 11 | `grounded-main` | grounded | Energy · NSW | Monorepo: React/Vite web, Node server, CLI, sim packages, Docker | sense, act, prove | launch point (needs build) | grounded-peach.vercel.app |
| 12 | `rantai-3c-master` | SupplyTrail | Carbon finance · Indonesia | Next.js/React/Tailwind, ethers.js, Sepolia contracts | finance, prove | launch point (needs `npm install`) | GitHub repo |
| 13 | `CarbonTrace-main` | TonneTrail | Carbon markets | React/Vite/Leaflet, FastAPI + web3 + shapely, Hardhat, Docker Compose | verify, finance, prove | launch point (`make install`, Docker) | none stated |
| 14 | `ClimateProof-AI-main` | ClaimGuard AI | Climate data QA | FastAPI + Streamlit + pandas, Render config | verify, prove | launch point (Python) | none stated |
| 15 | `flarewatch-main` | TorchSight | Gas flaring · Niger Delta | Node pipeline (NASA FIRMS), Solana program (Anchor/Rust), static web | sense, verify, prove | **`/apps/flarewatch/`** | flarewatch-ng.vercel.app |
| 16 | `gridproof-main` | WattCert | Renewable certificates | Vite/React web, Hardhat (TS) on Sepolia, Python FastAPI oracle | verify, finance, prove | launch point (needs build + oracle) | deployment in `deployments/sepolia.json` |
| 17 | `hourmatch-master` | HourSync | Renewable certificates · Taiwan | Hardhat/Solidity on Sepolia, Node ES modules, static `public/` | verify, finance, prove | **`/apps/hourmatch/`** | hourmatch.vercel.app |
| 18 | `plotlock-main` | ParcelSeal | Land claims · stubble | Solidity on Polygon Amoy, FastAPI oracle, static Leaflet map | verify, finance, prove | **`/apps/plotlock/`** (oracle not served) | none stated |

Bold entries are served by the gateway today. "Launch point" means the project is merged and linked, but needs its own install or build step (the registry's `readiness` field and the project's README say which).

## What was verified and what was carried over

- **Verified in this pass:** the folder list and file counts; each manifest (package.json, pyproject, Cargo.toml, pubspec, hardhat/foundry configs, Dockerfile); the README of the six projects that were missing from the earlier map; the static entry pages of the seven apps served at `/apps`; that each app's relative asset paths resolve under `/apps/<id>/`; that BlueTrail's service worker registers with a relative path, so it stays scoped to its app.
- **Run in this pass:** frontend typecheck, lint, 8 unit tests and production build; gateway test suite, 88 tests (80 existing, 8 new for the registry and `/apps`). Route checks over HTTP: 7 apps return 200; an unknown project returns 404; a traversal attempt returns 403 without file content. Browser check of the command center and BlueTrail app.
- **Carried over, not re-run:** the feature lists and evidence figures for the 13 projects from the earlier capability map, and test counts quoted from READMEs (for example TapAlert's 66 tests and TonneTrail's 27/50/8). Those are the projects' own claims.

## Security findings — to decide before any public push

Hardcoded private keys in source (copied into `projects/` as they were; not edited):

- `carbonshield-main/scripts/verify_contract.py:13` — `PK=` literal.
- `carbonshield-main/src/carbonshield/blockchain/contract.py:251` — default owner key.
- `carbonshield-main/src/carbonshield/blockchain/verifier.py:105` — default key.
- `CarbonTrace-main/backend/app/config.py:14` — `_DEV_VERIFIER_KEY`.
- `CarbonTrace-main/backend/scripts/e2e_demo.py:27-31` — admin and demo-account keys.
- `CarbonTrace-main/frontend/src/chain.ts:7` — demo key in frontend code, so it ships to the browser.

Most look like well-known local development keys. I did not confirm whether any of them is funded or used on a live network. Rotate or remove them before any public push.

Other notes:

- `/apps/*` is same-origin with the gateway. The memory vault API is on that origin, so a script running inside a project app could call it. The mitigation is to serve the apps from a separate origin. The apps are the user's own code, so I've accepted this for now and documented it here.
- Public transaction and report hashes in `carbonlens-main/dashboard/data/*.json` and `carbonshield` deployment files are not secrets.

## Known gaps

- Apps that need a backend (ImpactGraph dashboard, ParcelSeal oracle, SinkGuard API) are not served. The launchpad says so.
- MethaneMend, grounded, SupplyTrail, WattCert, UniqueCredit's source, and TonneTrail were not built or run here.
- ClaimGuard AI is linked as a launch point only; its FastAPI and Streamlit apps are not wired into the gateway.
- The hackathon test and evidence figures are the projects' own claims and have not been independently checked.

## Feature catalogue and workspace search

- Features in the 18 project folders and the central product are listed once in [`FEATURE_CATALOG.md`](FEATURE_CATALOG.md) and [`../registry/features.json`](../registry/features.json). Shared capabilities use one canonical feature with each project's status, summary, and file:line evidence retained as a separate implementation. Project entries point to canonical feature IDs.
- Project tracks are defined once in [`../registry/projects.json`](../registry/projects.json), served with the registry at `/api/v1/projects`, and used by the capability library, Launchpad, and mission studio. Cross-listed projects keep one project record and appear in every applicable track.
- Method: read-only source reading by seven code-explorer passes, one per group of projects, plus the central gateway and frontend. The raw per-project records are in [`feature-audit/`](feature-audit/). Nothing was run, so statuses come from reading the code and the projects' own claims are marked as such.
- Merge: `node scripts/build-feature-catalogue.mjs` rebuilds both files, collapses normalized duplicate names and reviewed repeated audit IDs, and fails if any registry claim would be lost. A registry feature with no matching code feature is carried over as `unverified` (three today). `gateway/tests/feature-catalogue.test.mjs` checks canonical uniqueness, project links, and retained evidence.
- Search: `GET /api/v1/knowledge/search?q=…&limit=…` and `GET /api/v1/knowledge/sources` return ranked, redacted excerpts from the root docs, project READMEs and docs, the registry and the catalogue, each with its source file and line. This is lexical BM25 only, so it generates no answer. The capability library has a search panel.
- REA was not used. These are source repositories, and REA is for shipped binaries and runtime capture.
