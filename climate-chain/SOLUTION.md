# Climate Chain — product and implementation

## Product intent

The 18 source climate projects address different points in an impact chain: community sensing, evidence review, local response, climate finance, and outcome proof. Climate Chain gives users one simple place to move through that chain. 18 native modules are re-implemented in climate-chain/frontend/src/modules from the source projects and run on bundled fixtures (8 SIMULATED, 6 RESEARCH, 4 DEMO). The original project folders are not included in this repository.

The shared unit is a **place-based climate mission**. A person begins with a local signal, checks the evidence and its age, chooses an intervention, sees how funding is controlled, and records what can be proven. The workspace guides and connects that process; it does not claim every source system has been merged into a single backend.

## User flow

### Command center

The home screen pairs a four-source overview with a 3D globe. It shows source-level signals, the season ledger, original signal views, and two clear next choices: start the guided path or browse all capabilities. Schematic globe arcs are decorative and are not measured relationships.

The overview globe contains schematic pilot beacons. Where current data includes coordinates, it also plots JunkSnap site locations and the selected Vayu query place. Household coordinates are excluded. Offline fallback data is labeled **SIMULATED** in the surrounding interface.

### Guided mission path

1. **Sense:** choose a focus and read the connected signal tiles. Air, Fire, Water and Waste open their live module views.
2. **Verify:** review the source, its freshness, and the rule the owning project applies. Capability recommendations vary by focus.
3. **Act:** open the app that owns the action and its approval flow.
4. **Finance:** review the specialist funding, escrow, registry, credit or marketplace mechanism and its execution status.
5. **Prove:** return to evidence that measures the outcome, checks reversals or duplicates, and states remaining uncertainty.

The focus choices are healthy neighbourhoods, cleaner harvests, trusted forest credits, methane repair, resilient power, and community stewardship. They help reduce the first decision to a manageable set of tools; the capability library keeps every project reachable.

### Unified mission studio

The studio starts with the full set of 18 project capabilities and groups them under Sense, Verify, Act, Finance and Prove. People can select a narrower toolset, add a focus bundle, review each project's feature and evidence notes, open its source tool, and export a Markdown mission brief. The mission scope and selection stay in the current browser session. Only JunkSnap, clearsky, Teesri Shikayat and Vayu have normalized live feeds; all other modules are native re-implementations that run on bundled fixtures (8 SIMULATED, 6 RESEARCH, 4 DEMO); the original project folders are not included in this repository.

### Place-based Waste-to-Air review

From an open JunkSnap site, choose **Review nearby air context**. Climate Chain queries Vayu at that public site point and shows monitor provenance, data age, observation times and configurable distance/time checks. A match is only a proximity lead for a person to review; it does not show that the waste site caused the air reading. The user can download a SHA-256 evidence manifest and continue in JunkSnap for its verification and clearance workflow. This central review is read-only.

### Capability library

The searchable library lists all 18 projects, including Climate Chain itself. Cards group capabilities by mission step and show the project domain, distinctive features, evidence note, readiness, and an app or source link. 18 native modules are re-implemented in climate-chain/frontend/src/modules from the source projects and run on bundled fixtures (8 SIMULATED, 6 RESEARCH, 4 DEMO). The original project folders are not included in this repository.

## System architecture

```text
                  Climate Chain React workspace
           command center · mission studio · guided path · capability library
                                │
                           /api/* only
                                │
               climate-chain zero-dependency gateway
              ┌────────┬─────────┬────────┬────────┐
              │        │         │        │        │
           JunkSnap  clearsky  Teesri     Vayu   normalized
             API      API      API       API     overview
              │        │         │        │
             Waste    Fire     Water     Air
                                │
             all other projects remain in their
             own app, storage, identity and approval flow
```

The overview gateway fans out to the four existing APIs in parallel and applies per-project normalizers. It presents source-level alerts, not a geographic or causal cross-project join. The separate versioned Cascade endpoint reads one public JunkSnap site and one Vayu response, then applies explicit time and distance checks. All other projects are connected through mission placement and capability entry points, not new API adapters.

## Shared data and provenance

The shared model in `frontend/src/types.ts` has project-specific fields for Waste, Fire, Water and Air, plus a versioned Cascade response. The gateway translates each native API response shape.

- A reachable upstream is labeled `live` and displayed as **LIVE**.
- An overview fallback is labeled `mock` and displayed as **SIMULATED**.
- A direct proxy failure returns a clear upstream error instead of substituting a success-shaped mock.
- Static project evidence in the capability library says when it is a project-reported field result, demo result, research foundation, read-only snapshot, or local/mock prototype.
- The hub does not combine different project totals into an asserted verified climate-impact number.

## Why the handoffs stay with specialist tools

Each source project has its own data, identities, consent, approvals and risk rules. For example, JunkSnap photo privacy and resident backing, Teesri resident-only case closure, clearsky farmer bookings, PLUME verifier signatures, and carbon-ledger freeze decisions must remain visible in the system that owns them. The central workspace does not issue credentials or silently submit writes on a user's behalf.

## Frontend structure

```text
frontend/src/
  App.tsx                       shell, navigation, four API states
  api.ts                        shared /api client and city presets
  types.ts                      normalized four-source data model
  data/capabilities.ts          18-project map and mission-stage map
  components/Globe3D.tsx        lazy-loaded interactive Three.js view
  modules/Overview.tsx          command center and path entry
  modules/Workspace.tsx         guided mission and searchable library
  modules/{Waste,Fire,Water,Air}.tsx   detailed connected signal views
  modules/CascadeReview.tsx      read-only evidence checks and manifest export
  styles.css                    responsive, reduced-motion-aware UI
```

The guided workspace and Cascade Review load on demand. The globe responds to pointer drag and wheel zoom; buttons remain the primary accessible route through the workflow.

## Local run

```powershell
cd climate-chain/frontend
npm install
cd ..
.\start.ps1
```

The launcher builds the frontend and runs `mission-supervisor.mjs`, which starts the loopback gateway and worker, restarts unexpected worker exits with capped backoff, and stops both on Ctrl+C. The main local startup path remains one command after the initial dependency install.

Open <http://localhost:8080>. In frontend dev mode, run `npm run dev` from `frontend/`; Vite proxies `/api` to port 8080. Configure `PORT`, `UPSTREAM_TIMEOUT_MS`, `JUNKSNAP_API_URL`, `CLEARSKY_API_URL`, `TEESRI_API_URL`, `VAYU_API_URL`, and `JUNKSNAP_BBOX` as needed.

## Current integration limits

- The gateway connects only JunkSnap, clearsky, Teesri Shikayat and Vayu. The rest are not presented as gateway-live sources.
- Project app links may have their own authentication, uptime, or demo constraints. A link in the directory does not guarantee its current availability.
- The gateway does not provide unified identity, a shared database, or cross-project write-back. Mission records persist on the local host in a checksummed JSON store, not a shared database. Persisted tasks can refresh ClearSky aggregate statistics and privacy-limited Vayu city-center air samples; other connectors remain dashboard reads.
- Current verification is recorded in `docs/workspace/GENESIS_FINAL_REPORT.md`: gateway and frontend tests (run npm test for current counts), frontend lint/type-check/build, encrypted retrieval-audit migration and corruption checks, worker-side ClearSky and Vayu fixture integrations, and isolated launcher health/encrypted-audit/shutdown smokes. Public upstreams were disconnected during the browser smoke; no production availability or specialist write workflow is claimed.
