# Five-minute demo: Climate Integrity Lab

One take, five one-minute parts. Every number on screen comes from Open-Meteo or the local chain at the moment you click, so the exact values will differ from run to run.

## Before you record

1. Restart the launcher so it loads the current code and deploys all three contracts: stop any running `start.ps1`, then run `.\start.ps1`. It is ready when it prints `Starting Climate Chain at http://127.0.0.1:8080`.
2. Open `http://127.0.0.1:8080/#integrity`. The header panel must read **LOCAL EVM · CHAIN 31337**. If it reads **OFFLINE · NOT ANCHORED**, the panel says why; a restart fixes a stale deployment.
3. If you already rehearsed today on the same chain, click **Start a new demo run**. Claims are limited to one per place, day and method, so a second rehearsal would otherwise hit the duplicate guard on its first claim. Restarting the launcher also clears the chain.
4. Check the internet connection. Without it, choose **Cached historical example** in step 1 and say so on camera; the page labels it.
5. Optional: open a terminal for the `curl` check in part 3.

## 0:00–1:00 · The problem

- Start on **Command center**. Click **Prove a climate signal on-chain: Integrity Lab →**.
- Say: "Climate claims break in three ways: the numbers get edited, the same evidence or benefit is claimed twice, and corrections overwrite what was said. This lab shows each failure being caught."
- Point at the header panel: the local EVM chain, the two registry addresses, and the note that the four accounts are internal test actors, not independent verifiers.

## 1:00–2:00 · Real evidence, honestly labelled

- **Step 1 · Signal.** Keep **New Delhi**, **PM2.5** and **Live, with a labelled fallback**. Click **Fetch the signal and build evidence**.
- Point at **MODEL FORECAST** and **LIVE FETCH** with its time, the ~45 km grid cell, the valid hours, and the 24-hour mean marked **DERIVED ESTIMATE** next to the WHO 2021 guideline note ("context, not a breach").
- Click **Continue to evidence**. **Step 2** shows the bundle SHA-256 and the SHA-256 of the raw provider response. Click **Recompute the digest in this browser**: the browser gets the same hash.
- Point at **It cannot prove**: model values are not monitor readings, concentration is not a cause, and nothing here is an emission reduction.

## 2:00–3:00 · On-chain proof, then an attack

- **Step 3 · Anchor.** Click **Anchor evidence on the local chain**. Read out the transaction hash, the block and **status 1**.
- Click **Verify independently**. The left column is this browser talking straight to the chain RPC: chain ID, contract code, the stored digest, `verifyDigest` and the receipt. Show **VERIFIED**.
- Optional: open **Reproduce from a terminal**, paste the `curl` command and show that the first word of the result is the same digest.
- **Step 4 · Tamper.** Click **Run the tamper test**. One value moves by 0.1, the digest changes completely, and the result is **VERIFICATION FAIL**; the contract accepts the original and refuses the altered copy. Say "controlled test data: we edited a copy, not the anchored record."
- Click **Replay the same evidence**: **REJECTED BY CONTRACT · EvidenceIdTaken**, mined with **status 0**.

## 3:00–4:00 · Duplicate claim, challenge, correction

- **Step 5 · Claim.** Click **Submit the demo claim**. Point at **DEMO / NOT A CERTIFIED CREDIT** and **UNVERIFIED CLAIM**, and read the statement.
- Click **Submit the same claim again**: **REJECTED BY CONTRACT · DuplicateClaim**, status 0. Say "the scope is the place, day and method, not the evidence, so swapping evidence cannot claim the same benefit twice."
- **Step 6 · Challenge.** Keep **Model value used as if observed**. Click **Submit the challenge (challenger account)**. Status becomes **CHALLENGED**.
- Click **Approve a correction (reviewer account)**. Show the lineage: the original evidence is superseded but still verifies, the revised evidence names it as parent, and the corrected claim supersedes the original. Nothing was overwritten.
- Click **Load the on-chain history** and point at the rejected attempts with their status-0 transactions.

## 4:00–5:00 · Why it matters

- **Step 7 · Next steps.** Read the first and last recommendations: compare with a reference-grade station before acting, and do not attribute a cause or claim an impact without a baseline and an independent verifier.
- Say who would use it: city air-quality teams, NGOs that publish environmental claims, and auditors who need to check those claims without trusting the publisher.
- Say how it scales: a public proof-of-stake network or rollup instead of the local chain; independent attesters instead of dev accounts; observed station data (OpenAQ) next to model data; the same registry pattern for water, waste and soil evidence.

## Live versus demonstrated

| Shown | What it really is |
|---|---|
| Air-quality values | Live Open-Meteo CAMS model forecast, or a labelled cached example of a real response |
| Hashes, transactions, blocks, receipts, revert reasons | Real, read back from the local EVM chain |
| Independent verification | Real: the browser re-hashes the bundle and calls the chain RPC itself |
| Tamper test | A real hash of a deliberately edited copy (controlled test data) |
| Claims, challenge and correction | Real contract transactions by dev accounts acting as claimant, challenger and reviewer. Internal review only. |
| Impact | None claimed. The claim is information-only and not creditable. |

## If something goes wrong on camera

| Symptom | Fix |
|---|---|
| Live fetch fails | The default mode falls back to the cached example and says so. Or choose **Cached historical example**. |
| **OFFLINE · NOT ANCHORED** | Restart `start.ps1`. Nothing is anchored, and no receipt is shown, until a real transaction succeeds. |
| First claim refused with `DuplicateClaim` | An earlier run holds that scope. Click **Open a new demo scope and keep this evidence**, then submit again. |
