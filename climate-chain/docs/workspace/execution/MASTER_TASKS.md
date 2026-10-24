# Master execution backlog

The complete machine-readable list contains all 240 tasks from the user's master prompt. It is stored in tasks.json with the original IDs, phase, title and current status.

## Dependency graph

The JSON graph is phase-level. Tasks inside one phase can be audited or implemented in parallel when they do not edit the same boundary. Phase dependencies:

| Phase node | Workstream | Depends on |
|---|---|---|
| phase-0 | Forensic repository audit | — |
| phase-1 | Platform architecture | phase-0 |
| phase-2 | Shared climate data foundation | phase-1 |
| phase-3 | Unified backend and API gateway | phase-2 |
| phase-4 | Civic climate intelligence | phase-3 |
| phase-5 | Carbon integrity engine | phase-3 |
| phase-6 | Methane intervention and verified funding | phase-3 |
| phase-7 | Energy resilience engine | phase-3 |
| phase-8 | Citizen science and governance | phase-3 |
| phase-9 | Cross-domain intelligence | phases 4, 5, 6, 7 and 8 |
| phase-10 | Shared evidence and trust layer | phases 2 and 9 |
| phase-11 | Autonomous agents with human approval | phases 3 and 10 |
| phase-12 | Command center frontend | phases 9 and 10 |
| phase-13 | Data and model engineering | phase-2 |
| phase-14 | Security and reliability | phases 3 and 10 |
| phase-15 | Deployment and local reproducibility | phases 12, 13 and 14 |

## Current execution

This run completed source audits, the audit/capability documentation, and the first read-only Waste-to-Air review path. See IMPLEMENTATION_STATUS.md and VERIFICATION_RESULTS.md for exact scope. The overall program is not complete; many of the 240 items remain not started or partial.

## Status meaning

- completed — the defined task was delivered and supported by evidence recorded in the status/results docs.
- partial — an executable slice exists, but task requirements remain.
- in_progress — work is actively underway.
- not_started — no implementation is claimed.
- blocked — only when a repeated external blocker prevents progress; none is currently recorded.
