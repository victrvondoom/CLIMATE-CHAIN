# Climate Chain — one mission path for climate action

Climate Chain brings the 18 project folders into one simple workflow: **Sense → Verify → Act → Finance → Prove**. People start from a place-based climate issue, follow the evidence rule that fits it, open the specialist action tool, and keep the result attributable to its source.

The product includes a command center, a guided mission path, a unified mission studio that composes features from all 18 project folders into a staged exportable brief, a searchable capability library, four climate source views, a read-only Waste-to-Air Cascade Review, a 3D data globe, and one gateway for the four APIs that have adapters. It also includes a local engineering memory studio, read-only MCP recall bridge, portable agent rules, and a durable local mission engine for bounded deterministic tasks.

## One folder, eighteen projects

Every project folder is merged into [`projects/`](projects/). Each keeps its original name and code; dependency and build folders were left out of the copy. [`registry/projects.json`](registry/projects.json) is the single list of projects. The gateway serves it at `/api/v1/projects`, and the launchpad and mission studio read the same file. Seven projects with a static UI open from `/apps/<id>/` on this origin. The rest open their live site or show their build step. The inventory and the reasons for each decision are in [`docs/REVERSE_ENGINEERING_INVENTORY.md`](docs/REVERSE_ENGINEERING_INVENTORY.md); the short pitch is in [`docs/PITCH.md`](docs/PITCH.md).

## Start it

```powershell
cd climate-chain/frontend
npm install
cd ..
.\start.ps1
```

Install frontend packages once, then `start.ps1` builds the current UI and launches the loopback gateway plus a supervised local mission worker. The supervisor restarts unexpected worker exits with capped backoff and stops both child processes on Ctrl+C. Open <http://127.0.0.1:8080>. For frontend development, run `node gateway/gateway.mjs` from the app root, `npm run worker` from `gateway`, and `npm run dev` from `frontend`; Vite proxies `/api` to port 8080.

## What is connected

| Signal view | Source project | Gateway data |
|---|---|---|
| Waste | JunkSnap | Site GeoJSON, coordinates, status and verification counts |
| Fire | clearsky | Field-risk and season counters |
| Water | Teesri Shikayat | Neighborhood reports, warning-ring state and case status |
| Air | The Vayu Project | Place, PM2.5 hours, severity and reading mode |

The overview queries these four sources in parallel through a validated connector registry and normalizes them into one model. It displays source-level signals; a regional counter is not treated as a spatial or causal join. Values from a reachable source are labeled **LIVE**; overview fallbacks are labeled **SIMULATED** with source error and provenance state. Direct upstream reads fail clearly when unavailable. The shared source proxy is read-only.

## Place-based Cascade Review

Open **Place-based review** or choose **Review nearby air context** from an open JunkSnap site. Select a public site, then Climate Chain queries Vayu at that location and checks observed station provenance, report/reading recency and the nearest monitor's reported distance against configurable thresholds. Passing checks create a human-review proximity lead, not a finding of causation or proof of pollution source.

The page shows source IDs, timestamps, monitor name/distance/age and uncertainty, and can download a SHA-256 evidence manifest. The manifest is a portable summary, not an immutable audit record. The review is read-only; JunkSnap remains the owner of report verification and clearance actions.

The versioned endpoint is GET /api/v1/cascade with site, radiusKm and timeWindowHours parameters. It bounds the radius to 50 km and the time window to 168 hours. If a live source is unavailable or its data is ineligible, the endpoint returns an error or an explicit non-candidate status; it does not insert mock data into a review. The UI offers a separate, opt-in `demo=1` local walkthrough that makes no public API request, labels both sources simulated and cannot create a candidate.

## The guided path

1. **Sense** — read local signals and choose a climate issue.
2. **Verify** — inspect evidence, provenance, and the applicable threshold.
3. **Act** — open the project that owns the response and approval rules.
4. **Finance** — review conditional funding, credit or marketplace capabilities.
5. **Prove** — connect the result to measured outcomes, reversals, and audit receipts.

The mission page filters recommendations by focus area. The capability library lists all 18 folders and lets people filter them by mission step. It identifies the source project's readiness and evidence status on each card.

Open **Unified mission studio** from the home screen or workspace navigation to compose a mission from the feature sets in all 18 folders. Its staged plan lists each selected project's features, readiness and evidence notes, links to its existing tool, and labels each feed with its current source mode. The five-stage planning/dry-run view remains browser-local and simulated. The durable local mission panel persists a validated DAG on the gateway and queues bounded deterministic tasks (observation summary, illustrative emissions scenario, report rendering) for a separate worker process. It records transitions, source state, memory retrieval IDs, validation and evidence, and can export a report. It does not execute specialist project actions or prove climate impact.

## 3D data view

Pilot arcs are schematic, not measured relationships. Cascade Review hides those arcs and does not plot Vayu's exact monitor location because the Today response does not return it.

The interactive Three.js globe retains the four pilot beacons, plots the waste-site coordinates returned by JunkSnap, and marks the selected Vayu place. It does not plot household coordinates. A source's `LIVE` or `SIMULATED` label remains visible in the surrounding interface.

## Boundaries

The four API integrations above are the only data adapters in the shared gateway. The other projects are connected as capabilities and launch points; they retain their own data stores, authentication, action flows, and approval processes. A cross-link does not imply a shared account, a shared transaction, or a centralized climate-impact claim. Demo and research results keep their original labels.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8080` | Gateway port |
| `UPSTREAM_TIMEOUT_MS` | `7000` | Per-upstream request timeout |
| `JUNKSNAP_API_URL` | JunkSnap CloudFront endpoint | Override the Waste source |
| `CLEARSKY_API_URL` | clearsky API Gateway endpoint | Override the Fire source |
| `TEESRI_API_URL` | Teesri Lambda URL | Override the Water source |
| `VAYU_API_URL` | Vayu API Gateway endpoint | Override the Air source |
| `JUNKSNAP_BBOX` | `72.85,26.15,73.15,26.45` | Jodhpur Waste pilot bounds |

See [`INTEGRATION.md`](INTEGRATION.md) for the source map and [`SOLUTION.md`](SOLUTION.md) for the detailed product flow.

## Local engineering memory for coding agents

Open **AI engineering memory** from the workspace navigation to dictate or write engineering judgments, review them, and save them into the separate local user sandbox. On Windows, the active vault is AES-256-GCM encrypted with a DPAPI CurrentUser-protected key. The app displays vault integrity and readiness state. A failed vault closes the supported mission recall gate with `CLIMATE_CHAIN_MEMORY_UNAVAILABLE`; this does not force an external agent to install or consult MCP.

Download `AGENTS.md` and the MCP JSON from the memory studio, install both in each coding agent, and restart its session. The app's read-only MCP bridge is `node gateway/memory-mcp.mjs`. Browser speech recognition may use the browser/provider; microphone capture was not verified. Storage, encryption limits, and setup are described in [`docs/engineering-memory.md`](docs/engineering-memory.md) and the workspace-level [`docs/workspace/MEMORY_V3.md`](docs/workspace/MEMORY_V3.md).

## Verification

Run `npm run lint`, `npm test`, `npm run typecheck`, and `npm run build` from `frontend`; run `npm test` from `gateway`. The current results and known limitations are tracked in `docs/workspace/GENESIS_FINAL_REPORT.md` and `docs/workspace/TEST_RESULTS.md`. Upstream availability varies; tests using local fixtures do not establish production connectivity.
