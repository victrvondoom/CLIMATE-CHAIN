# Climate Chain — the evidence chain for climate action, in one workspace

Written for: judges and the team presenting this build. Date: 22 Oct 2026.

## The problem

A climate claim usually breaks in the gaps between tools. A satellite flag sits in one app, a community report in another, a payment in a third, and the person asking "did this happen?" can't see the chain between them. Each project is good at its own step. None of them can show the whole path, and that is where credibility is lost: double counting, unverified claims, and outcomes that nobody can trace back to a signal.

## The idea

Climate Chain is the workspace where a climate signal becomes proof. Every mission follows the same five steps: **Sense → Verify → Act → Finance → Prove**. Eighteen climate projects sit on that path. Each keeps its own evidence rule, its own data, and its own approvals. The workspace connects them, shows where each claim came from, and refuses to merge what its owners haven't merged.

## What is built today

- **One folder, eighteen projects.** Every project folder lives in `climate-chain/projects/`, and the originals are untouched.
- **One registry.** `registry/projects.json` is the only list the gateway and the interface trust. The gateway serves it at `/api/v1/projects`; the launchpad reads the same file.
- **Standalone apps from one origin.** Seven projects open from `/apps/<id>/` in the same workspace: AquaQuest, Flarewatch, PlotLock, HourMatch, CarbonTwin, CarbonLens, and the EcoGraph story page. The gateway checks each app is present before linking to it.
- **Honest labels travel with the numbers.** Data from a reachable source shows as **LIVE**. Fallback values show as **SIMULATED**. Demo and research results keep their original labels.
- **Place-based review with evidence.** From an open JunkSnap site, Cascade Review checks Vayu air data at that point and exports a SHA-256 evidence manifest. A match is a lead for a person to review. It is not a finding of cause.
- **Mission studio.** Compose a mission from any of the 18 projects, arrange it across the five stages, and export a Markdown brief with the source labels attached.

## Why this is different

1. **Evidence rules stay with their owners.** Climate Chain never decides whether a flare, a plot, or a credit counts. It shows each project's rule beside its result.
2. **Proof you can hand over.** The Cascade review manifest carries source IDs, timestamps, and SHA-256 hashes, so a reviewer can check it without trusting the workspace. Mission briefs carry their source labels but are not hashed yet.
3. **No invented totals.** The workspace does not add up climate impact across projects. Overlapping claims are shown side by side, not summed.
4. **The registry is the single source.** Adding a project means one entry in `registry/projects.json`, not an edit in four places.

## What is next (not built yet)

- A shared receipt ledger, so a Flarewatch night and a HourMatch certificate can reference the same evidence hash.
- Serving the standalone apps from a separate origin, so an app can't reach the memory vault on the workspace origin.
- Backend routes for the projects whose apps need a server: the PLUME and CarbonShield APIs, and the PlotLock oracle.
- Verifying the feature claims carried over from earlier maps, project by project.

## Limits, stated plainly

- There is no shared identity, database, or write-back between projects. Each project keeps its own accounts and approvals.
- Only four live feeds (JunkSnap, clearsky, Teesri Shikayat, Vayu) are normalised by the gateway. The other projects are linked, not connected.
- Several projects use simulated or demo data. Their labels say so.
- Some hardcoded development keys in the source need review before any public push. See [`REVERSE_ENGINEERING_INVENTORY.md`](REVERSE_ENGINEERING_INVENTORY.md).

## The line for judges

Climate Chain doesn't ask whether climate action happened. It asks which chain of evidence says it did, and shows where that chain is still missing a link.
