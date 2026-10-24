# Dashboard consolidation

## Goal

Every existing page stays reachable. They now open inside one dashboard instead of
twelve sidebar pages and eighteen module pages. Nothing is removed. Every legacy hash
still opens the same destination.

## What changed

| Before | After |
| --- | --- |
| Long sidebar with 13 workspace/signal entries and 18 module entries | Sidebar keeps the brand, the search shortcut and upstream status. Destinations live in the dashboard's library rail. |
| Default landing: `#earth` | Default landing: `#overview` (Command center), now the dashboard home. |
| One page visible at a time | One-view focus, or a pinned grid of up to 4 views side by side. |
| No way to arrange views | Pins and layout are saved in this browser (`climate-chain-dashboard-v1`). |

## Legacy routes

Every hash that worked before still works and opens the same view in the dashboard:

`#earth #session #overview #memory #ledger #studio #mission #cascade #capabilities #waste #fire #water #air #module:<id>` (18 native modules).

Later addition: `#integrity` (Climate Integrity Lab) joined the Evidence group as destination 32. The 31 earlier destinations are unchanged. See [`blockchain-integrity.md`](blockchain-integrity.md).

## Design decisions

- **Pins are capped at 4.** Each pinned view mounts its full component. The cap keeps the
  Cesium globe and the Three.js hero from stacking more than four WebGL-heavy panes.
- **Each panel keeps its own error boundary and Suspense.** One broken module cannot take
  down the others in the grid.
- **Layout state is local.** It lives in `localStorage` with `try/catch` on every access.
  Storage that is blocked or full falls back to defaults, and the toolbar says so.
  No data leaves the browser.
- **The rail is filterable.** With 31 destinations, a "Find a view" field matters more than
  the grouping.
- **The module group is collapsed by default** unless the open view is a module or the filter
  is active.

## Scope boundaries

- No backend, API or data-schema change.
- No change to any module's own page content.
- No commit is made here. The change sits in the working tree on `merge/one-app`.

## Verification

- `npx tsc --noEmit` (baseline: passing)
- `npx vitest run` (baseline: 67 files, 466 tests)
- New tests: `src/dashboard/library.test.ts` (legacy-route and preservation checks) and
  `src/dashboard/prefs.test.ts` (sanitising, storage failure, pin cap).
- Browser smoke at desktop and phone width (see the final report for results).

## Rollback

Revert the working-tree change to `frontend/src/App.tsx`, `frontend/src/data/capabilities.ts`
and remove `frontend/src/dashboard/`. The only persisted key is
`climate-chain-dashboard-v1`; deleting it restores defaults.

## Review record

Condensed review, not the full multi-voice `/autoplan` pipeline.

- CEO scope: merge, do not remove. Hash compatibility is required.
- Engineering: state lives in App (the owner of every view's props); the dashboard receives
  a `renderView` callback instead of duplicating props.
- Risk accepted: Cesium and Three.js panes in the grid cost GPU time. Mitigation is the pin cap.
