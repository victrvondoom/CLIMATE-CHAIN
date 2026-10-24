# Data access, API key and MCP evidence

## Evidence shown in the app

Open **Data, keys & MCP evidence** in the dashboard's Evidence group. It reads the current overview snapshot, gateway health probes and `/api/v1/evidence/integrations`. For each shared source it shows the endpoint, operation/schema, live or simulated mode, fetch time, request ID, latency and attempt count when the source supplied those fields. A source outage stays visible as a simulated fallback or a failed health check.

The download includes the source health result, overview snapshot, credential state and a SHA-256 digest. The digest covers the canonical overview JSON and detects byte changes after capture. It is not a provider signature and does not establish that a source observation is accurate, current, causal or proof of impact.

## Shared gateway credentials

| Provider or route | Credential required by the shared GET adapter | Evidence and limit |
|---|---|---|
| JunkSnap | No | The central adapter makes a public GET for site records. Its legacy passthrough can forward a caller's Authorization header, but the normalized shared read does not require one. |
| clearsky | No | Public stats GET; source response and health probe are shown separately. |
| Teesri Shikayat | No for the aggregate read | Public aggregate GET is privacy-filtered. Source write actions that require a token remain outside the central adapter. |
| The Vayu Project | No | Public read GET; the response provenance distinguishes station, model and simulated data. |
| OpenAQ v3 | Optional `OPENAQ_API_KEY` | No OpenAQ adapter ships in the gateway. The evidence route reports only whether the variable is present; a present value is unused and unvalidated. |
| Cesium ion | Optional `VITE_CESIUM_ION_TOKEN` | A browser-visible client token for optional World Terrain only. The UI reports build-time presence, never the token value, and does not claim provider validation. |

The endpoint returns configured/present booleans only; it never returns, logs or hashes credential values. API URLs are sanitized to origin and path. A live source response is evidence of a completed fetch, not proof of the source's claim.

This inventory covers Climate Chain's shared gateway and optional globe/data credentials. The merged specialist projects retain their own secret stores and APIs. Their keys are not imported into the gateway, and the central app does not claim that those credentials are present or validated.

## Project live-data MCP

`gateway/live-data-mcp.mjs` is a local stdio MCP server with three read-only tools:

- `climate_chain_get_live_overview` reads all four normalized sources and returns each source's mode and provenance.
- `climate_chain_check_public_sources` runs the upstream health probes.
- `climate_chain_fetch_cascade_evidence` requests a live-only JunkSnap/Vayu review and returns the manifest digest.

The server accepts only a loopback `CLIMATE_CHAIN_GATEWAY_URL`. It does not bind a network port, use provider keys, or expose write/approval actions. The existing engineering-memory export includes the MCP configuration for both this server and `memory-mcp.mjs`; download it from **AI engineering memory → Download MCP setup**, add it to the local agent's MCP settings, and restart that agent. The application itself does not declare a remote HTTP MCP URL.

## Current run proof

The evidence page is dynamic. Use **Refresh evidence** to trigger new overview and health reads, then inspect the receipt timestamps and modes before exporting. If a route is offline, the export records its error/fallback rather than converting it into live evidence. The source API server state can change after this document is written; rely on the current receipt for each run.
