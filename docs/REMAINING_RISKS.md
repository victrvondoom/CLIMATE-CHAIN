# Remaining risks and unfinished Genesis scope

## Local memory

- Storage is an encrypted versioned JSON vault, not SQLite/WAL. File locks and atomic replacement provide bounded single-user commits, not relational queries or a shared/high-volume database. Direct `node:sqlite` adoption conflicts with the supported Node >=20 range and the verified runtime marks the built-in experimental; a portable driver-backed migration remains open.
- Windows DPAPI CurrentUser protects the key at rest; a same-user compromised process can access it. Other operating systems require an external 32-byte key to enable encryption. Older plaintext vault or retrieval-audit migration copies are preserved and need deliberate review/cleanup by the user.
- Checksums detect corruption, not a capable attacker who can rewrite data and recompute hashes. Semantic embeddings are absent; lexical plus explicit graph recall misses paraphrases and undeclared contradictions.
- Sensitive data review is explicit user confirmation, not automatic secret or PII detection. Voice capture was not verified; browser speech recognition may process audio through an external provider.
- MCP and exported rules require per-agent setup. External agents cannot be forced to use the memory; the readiness gate only applies to supported local mission flows.

## Mission execution and agents

- Mission state is durable on the local gateway. The launcher supervisor restarts a crashed polling worker with capped exponential backoff and worker startup recovers expired leases. There is no external durable broker or OS service; if the supervisor/host exits, the user must rerun the launcher.
- Tasks are deterministic allowlisted handlers. There is no model-backed planner, eight-role agent delegation, LLM integration, context budgeting, unrestricted tool system, or resource accounting beyond bounded input/step/lease/retry limits.
- Evidence is a structured local record with checksums and validation; it is not a cryptographic signature or proof of external climate outcomes. Memory IDs are recorded but saved instructions are not interpreted by deterministic handlers.
- No shared identity/auth between processes of the same OS user. No remote gateway deployment is supported. Keep the explicit loopback binding; do not publish via tunnel or reverse proxy without a separate security design.

## Data and product integration

- Only DumpWatch, AshAlert, TapAlert and AirPulse have central read adapters. All were disconnected in the live browser smoke; fallback overview values were labeled simulated. Fixture integration tests do not prove production availability.
- Persisted connector tasks currently support AshAlert aggregate statistics and AirPulse city-preset PM2.5 samples. DumpWatch site features and TapAlert household feeds remain dashboard-only until separate privacy-reviewed projections are added.
- Worker heartbeat, age, stale/missing/corrupt state, restart count and backoff are exposed by the local gateway health endpoint and frontend health panel. Supervisor/worker control is still local-process-only and has no remote authenticated operations API.
- The remaining eight specialist projects are launchable handoffs, not centrally executed data services. No shared identity or common storage transaction exists.
- Climate scenario handling is an illustrative linear simulation, not a forecast or measured pathway. Cascade is a human-review proximity/recency lead, not causal evidence.
- Globe3D is a separate lazy-loaded chunk but remains 553.57 kB minified and triggers the Vite advisory. A named-import experiment measured no reduction and was reverted; a smaller renderer or a deliberate user-initiated load needs a separate visual and performance review.

## Verification gaps

- The browser mission test was manually driven with Playwright CLI, not committed as automated E2E tests. Automated axe/accessibility, reduced-motion, low-bandwidth and device tests were not run.
- The microphone, external agent installation, production deployment, hosted CI, and penetration testing were not verified.
- Not all twelve requested failure-injection conditions were executed. Gateway unit tests cover corruption, bad memory keys, concurrency, expired leases, retries, stale worker tokens, idempotency, invalid DAGs, unauthorized origins, and disconnected connectors; malformed model responses and browser reload during an asynchronous worker are not applicable/implemented here, but do not have corresponding tests.
- Specialist-project results in `TEST_RESULTS.md` are prior workspace audit results and were not rerun in this pass. Optional dependencies and cloud services still limit their verification.
- No root Git metadata/history was found; no commit provenance is claimed.
