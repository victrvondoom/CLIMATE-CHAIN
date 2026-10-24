# Local mission execution

## Architecture

The React workspace calls the local Node gateway. The gateway persists mission definitions, task state, transitions, and evidence to a checksummed JSON envelope under the user's application-data directory (`%LOCALAPPDATA%\ClimateChain\Missions\missions-v1.json` on Windows). `CLIMATE_CHAIN_MISSIONS_PATH` can select an isolated path for tests. Writes use an inter-process lock and atomic replacement. Malformed or corrupt data is reported; it is not replaced with an empty store.

Supported mission states are `CREATED`, `VALIDATED`, `QUEUED`, `RUNNING`, `WAITING_APPROVAL`, `PAUSED`, `RETRYING`, `FAILED`, `CANCELLED`, `BLOCKED`, and `COMPLETED`. Every transition has an event and timestamp. Dependencies are validated as a DAG before queueing. Idempotency keys prevent duplicate mission creation. Task leases, bounded automatic retries, stale-worker rejection, and explicit retry allow safe recovery from a gateway/worker interruption at the engine boundary.

## Current execution boundary

Allowlisted task types are `climate.observation_summary`, `climate.emissions_scenario`, `climate.connector_snapshot`, and `report.render`. The first, second, and fourth are deterministic local handlers, not model agents. The connector task supports read-only `clearsky.stats` and `vayu.today` calls through the typed registry. ClearSky persists reviewed aggregate counters. Vayu accepts only configured city preset IDs and persists at most 24 PM2.5 samples with the source-reported data kind; exact coordinates, place/station identifiers, and rationale text are dropped. A source task is added only when that feed is connected at mission creation. Both connectors validate schemas and attach provenance, without treating transport success as measurement verification. No task can run shell commands or use general filesystem/database/network tools. The emissions path is a linear illustrative scenario with stated assumptions and is labeled a simulation, not a forecast or observation. The source review task reports source-mode/provenance without silently treating mock data as live.

Before a mission enters the worker queue, the gateway verifies the memory vault, performs project-scoped lexical/graph recall, and checks declared conflicts associated with recalled records. Failure or relevant conflict prevents queue preparation. The mission stores retrieved memory IDs, timestamp, and manifest digest. The separate `mission-worker.mjs` process claims only queued tasks with a readiness trace no older than five minutes; the engine independently enforces the presence of that trace. Deterministic task handlers do not execute saved memory text; evidence says so. Completion evidence includes the task/tool identifier, input/output digest, validation, source classification, memory trace, timestamp, and human approval data when applicable.

Mission routes accept loopback clients and local origins only. Gateway data storage is local to the OS user. There is no shared identity system or authorization between processes of that same OS user.

## API and UI

- `GET/POST /api/missions`: list or create.
- `GET /api/missions/:id`: mission and events.
- `POST /api/missions/:id/{validate,queue,run,pause,resume,cancel}`: state actions. `run` performs the memory gate and returns `202 queued_for_worker`; it does not execute work in the HTTP request.
- `POST /api/missions/:id/approve/:taskId` and `/retry/:taskId`: explicit task decisions.
- `GET /api/missions/:id/evidence/:taskId`, `/export`: evidence or checksummed definition export.
- `GET /api/health`: gateway, memory, mission-store and connector health with correlation ID.

The Mission Studio exposes mission list, validation/queue controls, memory-gated worker queueing, pause/resume/cancel, source status, task events, evidence inspection, and Markdown report export. It refreshes queued worker progress automatically. The normal `start.ps1` launcher runs `mission-supervisor.mjs`, which starts the loopback gateway and worker, restarts unexpected worker exits with capped exponential backoff, and shuts both down over signals/IPC. Manual development can still run `npm run worker` in a second terminal. When a queued mission's retrieval trace is older than five minutes, the worker repeats integrity, scoped recall and conflict checks and refreshes the manifest before claiming. The earlier browser-local five-stage dry run remains separate and clearly simulated.

## Verification and limits

Gateway tests cover state transitions, invalid dependencies and task types, approval, idempotency, duplicate engine instances, leases, crash recovery, retry, cancellation, corruption detection, export/import checksums and persistence after a new engine/gateway instance. An isolated HTTP integration test starts the independent worker process, reads local ClearSky and Vayu fixtures through the configured registry, verifies aggregate and city-preset privacy projections with provenance, completes a dependent report, restarts the gateway and confirms persistence. A child-process test injects a worker crash and verifies supervisor restart, capped backoff, and IPC shutdown. See `TEST_RESULTS.md`.

There is no durable broker or OS service; the local launcher supervisor restarts worker crashes but cannot restart itself if the host or supervisor exits. Resource limits are bounded inputs/steps/leases/retries rather than CPU/memory quotas. There is no model-backed planner, agent-role scheduler, or general evidence-signature system. A completed local task is evidence of that deterministic handler's output, not proof that a climate outcome occurred.
