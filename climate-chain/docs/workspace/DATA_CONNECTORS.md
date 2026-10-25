# Climate data connector registry

## Registry behavior

`climate-chain/gateway/connectors/registry.mjs` defines typed read operations for four existing integrations. It reports configured source contracts separately from current reachability. Each request has a timeout, bounded retry for transient failures, a 2 MiB maximum response body (configurable up to 64 MiB), schema validation, a circuit breaker, a 15-second response cache bounded to 128 entries and 16 MiB of serialized UTF-8 payloads, and source provenance including endpoint, operation, fetched time, latency, retry attempts, and cache status. The byte limit is enforced against both declared content length and streamed bytes for data and health responses. The cache byte budget counts serialized payload bytes; parsed JavaScript objects consume additional heap. Unsafe query keys and non-scalar values are rejected. Invalid or oversized source responses are errors, not live observations.

Routes:

- `GET /api/connectors`: configured contracts and runtime status.
- `GET /api/services`: active source health checks.
- `GET /api/unified/overview?city=delhi|jodhpur|chandigarh`: normalized four-source overview.
- `GET /api/v1/cascade`: read-only, provenance-checked Waste-to-Air review.
- Legacy `/api/{junksnap,clearsky,teesri,vayu}/...` proxy now accepts GET/HEAD only.

Connector endpoints are configured by `JUNKSNAP_API_URL`, `CLEARSKY_API_URL`, `TEESRI_API_URL`, and `VAYU_API_URL`. `UPSTREAM_TIMEOUT_MS` bounds source calls. The DumpWatch area is configured with `JUNKSNAP_BBOX`.

## Mission worker read boundary

The durable mission worker exposes one allowlisted connector task type: `climate.connector_snapshot`. AshAlert accepts only `{ "connector": "clearsky" }` and invokes typed `stats`; AirPulse accepts only `{ "connector": "vayu", "city": "delhi|jodhpur|chandigarh" }` and maps that preset to a configured city-center query. The gateway overview and worker share one reviewed AirPulse preset table, while only numeric coordinates are sent upstream. The frontend adds either source task only when the current overview reports it connected. The worker re-fetches through the registry so response byte bounds, timeout, transient retry, response validation, and provenance apply at execution time. AshAlert output is projected to `CLEARSKY_AGGREGATE_FIELDS`. AirPulse output is limited to the last 24 timestamped PM2.5 samples, their reported `observed`/`forecast`/`pattern` kind, city key, and source mode; coordinates, place/station identifiers and free-text rationale are omitted. Both carry source provenance and explicit uncertainty. These checks validate the returned schema and transport, not the upstream measurements.

DumpWatch site features and TapAlert household records are not mission-readable. They need separate privacy-reviewed aggregate adapters before raw or derived results are persisted in mission history. AirPulse place-level fields are not persisted by the city-preset adapter. When an external feed is unavailable, the UI does not create its refresh task from a simulated overview; the existing dashboard snapshot remains explicitly labeled by its source mode.

## Domain and provenance boundaries

Waste observations, fire counters, water aggregate summaries and air readings remain distinct domain shapes. Each carries source/mode/freshness and units where supplied. The integration does not combine incompatible measures into one climate score. TapAlert's central representation is an aggregate and omits household IDs, message text, and coordinates. Cascade is only a human-review proximity/recency lead and does not infer causality.

## Live verification state

The registry and worker integration tests use local fixture upstreams and confirm four schemas, health states, provenance, retry/timeout/breaker/cache behavior including aggregate byte-budget eviction, malformed and oversized-response rejection (including chunked bodies without `Content-Length`), AshAlert aggregate projection, AirPulse city-preset bounds and privacy projection, and dependent report execution. In the browser smoke for this run, production upstreams were not reachable; the dashboard reported disconnected sources and labeled overview fallback data as simulated. No current real-world observation or external endpoint uptime is claimed.

Eight sibling capability sets still have independent source APIs/data/runtime; they remain handoffs in the central app. Expand only after a project-owned, authenticated, typed read contract is established. Central source writes are blocked by the legacy proxy method restriction.
