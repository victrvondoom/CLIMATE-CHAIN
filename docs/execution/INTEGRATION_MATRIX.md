# Integration matrix

| Source | Central adapter today | Data used | Mode and privacy boundary | Writes |
|---|---|---|---|---|
| DumpWatch | Yes | Public sites GeoJSON and timestamps | Per-source live/mock; public site points only | None; original app owns verify/clear |
| AshAlert | Yes | Regional /api/stats aggregate | Live/mock at transport; aggregate may contain demo/seed mixture | None; original app owns booking/alerts |
| TapAlert | Yes | /api/state reduced to aggregate report/warning/ring counts | Live/mock at transport; identifiers, messages and household coordinates omitted from the central response | None; source owns warning/closure policy |
| AirPulse | Yes | /v1/today and provenance | Live/mock at transport plus data-level mode; station/model distinction retained | None; original app owns user and hardware flows |
| CarbonScope | No | No shared import | Synthetic project scenes/claims | None |
| SinkGuard | No | No shared import | Research artifacts; rights unresolved | None |
| UniqueCredit | No | No shared import | Candidate findings from attributed registry dataset | None |
| ImpactGraph | No | No shared import | Synthetic graph cases | None |
| MethaneMend | No | No shared import | Historical Carbon Mapper records; repairs simulated | None |
| Grounded | No | No shared import | Isolated scenario model and SQLite state | None |
| BlueTrail | No | No shared import | Browser-local mock/prototype data | None |
| SupplyTrail | No | No shared import | Mixed demo and contract UI; never trust random fallback as tx proof | None |

## Current cross-domain case

DumpWatch public waste point -> AirPulse nearest station context. The only central join currently enforced is evidence presence + source mode + selected time window + nearest-monitor distance. It does not show causal impact. If a source is unavailable, the cascade route returns an error instead of substituting mock data. A missing timestamp, station identity, source mode or distance remains an explicit unknown/failure. Existing passthrough routes preserve their source API contract and forwarded authorization; the TapAlert state response is allowlisted to aggregate fields before returning to the central client.

## Safe expansion contract

Before a source is added, require its authoritative read route, source license/terms, normalized schema, synthetic/live/replay mode, observation and collection timestamps, location precision, privacy/access tier, timeout/failure behavior and deterministic local fixture. Default to GET-only. Store source IDs and links; never merge identities based on names or proximity alone.
