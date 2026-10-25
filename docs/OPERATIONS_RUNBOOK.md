# Local operations runbook

## Start the integrated application

In PowerShell:

```powershell
cd "<workspace>\climate-chain\frontend"
npm install
cd ..
.\start.ps1
```

`start.ps1` builds the frontend and runs `mission-supervisor.mjs`. The supervisor starts the gateway bound to `127.0.0.1:8080` and a separate local mission worker. It restarts an unexpectedly exited worker with capped exponential backoff and stops both child processes when the gateway exits or Ctrl+C is pressed. Open `http://127.0.0.1:8080`. Node 20 or newer and installed frontend packages are required.

For local frontend development, open three PowerShell sessions: run `node gateway/gateway.mjs` from `climate-chain`; run `npm run worker` from `climate-chain/gateway`; run `npm run dev` from `climate-chain/frontend`. The Vite development server proxies `/api` to port 8080. Mission Studio's queue action performs memory readiness and enqueues; the separate process performs the task.

## Local data locations

- Windows memory vault and keys: `%LOCALAPPDATA%\ClimateChain\AgentMemorySandbox`.
- Windows missions: `%LOCALAPPDATA%\ClimateChain\Missions\missions-v1.json`.
- Linux/macOS memory and mission data use the configured OS/application-data base where available; use explicit environment overrides for isolated test roots.
- Memory override: `CLIMATE_CHAIN_MEMORY_DIR`, outside source tree.
- Mission override: `CLIMATE_CHAIN_MISSIONS_PATH`.

Do not point test or corruption commands at the regular user vault. Back up before manual file operations. Memory restore and key rotation are application UI workflows with explicit review/confirmation. A DPAPI-protected key is user-bound; protect Windows account credentials and recovery materials.

## Health and connectors

`GET /api/health` reports readiness, local correlation ID, memory and mission-store integrity, and connector status. `/api/connectors` reports configuration separately from source reachability. A degraded connector can return a clearly labeled simulated overview fallback; do not use such output as measured data. Inspect source-specific error and freshness in the app before reporting.

Persisted missions can refresh AshAlert aggregate `stats` and privacy-limited AirPulse `today` samples at one of the configured city centers, and only when the overview reported that feed connected at mission creation. The worker re-queries through the connector registry. AirPulse mission records omit query coordinates, place/station identifiers, and free-text rationale. DumpWatch site features and TapAlert household records remain dashboard-only until source-specific mission adapters pass privacy review.

Environment variables: `PORT` (default 8080), `UPSTREAM_TIMEOUT_MS`, four `*_API_URL` source overrides, `JUNKSNAP_BBOX`, `CLIMATE_CHAIN_MEMORY_DIR`, `CLIMATE_CHAIN_MISSIONS_PATH`, `CLIMATE_CHAIN_MEMORY_ENCRYPTION`, `CLIMATE_CHAIN_MEMORY_KEY`, `CLIMATE_CHAIN_WORKER_ID`, and `CLIMATE_CHAIN_WORKER_POLL_MS` (100–30000 ms; default 750). The application gateway remains loopback-bound; `PORT` changes the port, not its network exposure. Worker startup recovers expired leases. In manual development without the supervisor, restart a worker that exits unexpectedly.

## Troubleshooting

- **Gateway unavailable:** confirm Node >=20, port 8080 is free, and the terminal process is running.
- **Memory readiness unavailable:** open Memory Studio, inspect integrity/encryption status, and restore only a reviewed valid backup. Keep the vault bytes for diagnosis; do not replace them with an empty file.
- **DPAPI/key error:** use the same Windows account that created the keyring. On external-key systems, restore the exact user-managed key. Never create a new key and overwrite the old vault.
- **Mission store unavailable:** preserve the file and inspect the returned integrity error. A corrupt store is not auto-reset.
- **Source disconnected:** inspect `/api/services`, connector configuration and the upstream owner. The dashboard's fallback is simulated.
- **Agent has no memory:** install the exported local stdio MCP configuration and project rules in that agent, then restart its session. The app cannot force an unconfigured agent to read them.

## Diagnostics and privacy

Gateway health includes a correlation identifier. Export only the diagnostic fields needed to reproduce an issue. Do not attach transcripts, credentials, personal data, precise household locations, plaintext vault backups, or key material to public issues.
