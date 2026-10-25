# Dynamic workspace

Open <http://localhost:8080>. Run `./start.ps1` from the app root to build and launch the gateway with its worker.

## Behavior

| Area | Current behavior |
| --- | --- |
| Shared signals | Refresh every 30 seconds; one selected snapshot powers signal views and the four native source tools. Manual refresh, focus and reconnect also refresh reads. |
| Source and tool status | Rechecked every 60 seconds, with explicit failures and retry. |
| Request lifecycle | Requests time out after 30 seconds. Polls do not overlap, pause in hidden tabs, and reject results from prior selections. Failed refreshes retain the last successful snapshot and its receipt time. Remote signal polls pause offline; localhost vault and mission reads can continue when the gateway is reachable. |
| Signal exploration | Waste search/status/proof/sort, fire risk/progress views, water aggregate drilldown, air type/window/reading selection, priority feed filters, filtered JSON exports and source provenance. |
| Native results and review | Module outcomes update immediately, can become validated packets for a selected stage, and receive explicit human verdicts. The ledger supports search, inspection, hash verification and export. Browser storage changes propagate across tabs. |
| Research audit tools | SinkGuard accepts validated project JSON, recalculates missingness over selected rows, preserves the dataset in tab session storage, and records input rows plus a dataset digest. UniqueCredit filters candidates and records reproducible Merkle proofs. CarbonScope filters reports and reruns hash verification. |
| Mission preparation | Checklists persist by climate focus and mission stage. Launchpad filters reflect reported local availability, and project details expand in place. |
| Durable missions | History, selected task details and gateway/worker health refresh independently. Explicit task approve/reject/retry and validated-mission queue controls call existing gateway actions. Operator details and review remain required for task decisions. |
| Engineering memory | Polls every 15 seconds; searches refresh when vault content changes. Errors close the recall gate until a successful read, and incoming refreshes preserve unsaved edits. |
| Navigation and globe | Hash links preserve the selected screen through reload/back/forward. Compact mobile navigation expands on demand and closes after a screen is selected. Globe updates follow coordinate changes, retain view position, and provide a message if WebGL is unavailable. |

## Data scope

The gateway has four public source adapters. Reachable source responses retain their own provenance; fallback values remain SIMULATED. A successful fetch does not establish that an observation is recent. Research and demo tools retain their original scope. Local queue decisions and file imports do not execute specialist field actions or change external project records.

Evidence and review decisions remain in browser local storage. Imported SinkGuard datasets remain in tab session storage; failed storage writes are reported. Missions and engineering memory use the existing local gateway stores. Background refreshes do not approve work.

## Verification on 23 October 2026

- Frontend lint, TypeScript build and 436 tests across 64 files passed.
- Added regression coverage for observable local storage, unavailable storage, overlapping verdicts and project JSON intake validation.
- Playwright exercised dataset import/filter/audit, evidence-to-review queuing, an explicit verdict, cross-tab synchronization, filtered snapshot download and checklist persistence.
- Browser routing checks used explicitly simulated responses to verify failed refresh retention, retry, location-response races, series selection, offline status, local recall availability, reconnect and automatic polling. Routes were removed afterward and the real gateway snapshot restored.
- Build retains the existing large JavaScript chunk warning. Verification covers the central workspace; external project deployments and production actions were not exercised.
