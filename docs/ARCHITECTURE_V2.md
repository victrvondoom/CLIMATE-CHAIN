# Climate Chain v2: one app, eighteen native modules

Written for: engineers porting project features into the single app. This document supersedes the hub description in `SOLUTION.md` and `INTEGRATION.md`.

## What changed and why

The v1 workspace was a hub. Each project was linked, or opened in a frame, as its own app. A user saw one dashboard per app, and the workspace had no shared model. v2 is one product. Each of the 18 project folders becomes a **native module**: its features are screens and domain logic inside the same app, with one navigation, one command palette, one evidence ledger, and one build.

Nothing is deleted. The v1 pages (Command center, Mission studio, Guided path, Place-based review, AI engineering memory, the four signal views) stay. The standalone `/apps/<id>/` routes stay as reference copies. Modules are added beside them.

## The module contract

Every module lives in `frontend/src/modules/<id>/` and exports one `ClimateModule` object from `module.tsx`. The contract is `frontend/src/core/module.ts`.

```ts
export interface ClimateModule {
  id: string;             // equals the registry id, e.g. "flarewatch"
  name: string;
  tagline: string;        // one sentence, what the module does
  stages: StageId[];      // sense | verify | act | finance | prove
  tone: string;           // matches a registry tone, e.g. "methane"
  mode: EvidenceMode;     // LIVE | SIMULATED | DEMO | RESEARCH for the data it shows by default
  features: string[];     // only what the Page actually does
  source: { folder: string | null; files: string[] }; // what the port was derived from
  Page: ComponentType;    // from react; a function component that renders the module screen
}
```

Rules for a module:

1. **Domain logic is pure TypeScript** in `domain/`, with no React and no DOM. Port the project's rules, not its framework. Each rule gets a unit test. Where the source has tests or fixtures, reuse their expected values as test vectors.
2. **Data is inherited, not invented.** Copy the smallest fixture from the source folder into `fixtures/` (keep each file under 200 KB). Put the source path in `source.files`. If the feature needs a live source, call an existing gateway route only; do not add a route.
3. **Honest labels.** Use `mode` for the data the module shows. Fixture data is `SIMULATED` or `DEMO` unless it is a measured result copied from the project's own outputs, which is `RESEARCH`. Never label fixture data `LIVE`.
4. **Hashing and evidence** go through `src/core/evidence.ts`. A module records evidence with `createEvidence` and `appendLedger`. It does not write its own storage.
5. **Surgical scope.** A module touches only `frontend/src/modules/<id>/`. Do not edit shared files (`App.tsx`, `capabilities.ts`, `styles.css`, `package.json`, the registry, the gateway). If a module needs a shared change, stop and report it.
6. **CSS** lives in `modules/<id>/module.css`, and every class starts with `m-<id>-`. Import it from `module.tsx`.
7. **No new dependencies.** The app already has React, Three.js, Vite, Vitest, and ESLint.

## Shared core

- `src/core/module.ts`: the contract above, plus `StageId` and `EvidenceMode`.
- `src/core/evidence.ts`: `canonicalJson`, `sha256Hex` (WebCrypto), `hashValue`, `createEvidence`, `readLedger`, `appendLedger`. The ledger is `localStorage` with try/catch around every access, and a page must still render when storage is unavailable.
- `src/modules/index.ts`: the module list the shell renders. Only the integrator edits this file.

## Stage and workflow

The shell groups modules by mission stage. A module can appear in several stages. The command palette lists every module. The Overview launchpad opens the native page, and the old standalone link is shown as a secondary action.

## Verification every module must pass

Run these inside its worktree, from `frontend/`, after `npm ci`:

```bash
npx tsc --noEmit
npx eslint src/modules/<id>
npx vitest run src/modules/<id>
```

A module is done when all three pass, its `features` list matches what its Page does, and its evidence mode is correct.

## Ownership of the 18 modules

| Agent group | Modules |
|---|---|
| A | junksnap, clearsky, teesri |
| B | vayu, aquaquest, climateproof |
| C | plume, flarewatch, gridproof |
| D | carbonlens, carbonshield, carbontwin |
| E | ecograph, grounded, carbontrace |
| F | hourmatch, plotlock, rantai |

The registry id is the module id. For example, `rantai` is the id for `rantai-3c-master`, and `vayu` is the id for `the-vayu-project-main`.
