# Data sources for the Climate Integrity Lab

Which sources the lab uses, how each is labelled, and which are not integrated. Facts marked "provider documentation" were read from the provider's page on 2026-10-23.

## Sources in use

| Source | Status in this build | Kind | Variables and unit | Resolution | Access and terms |
|---|---|---|---|---|---|
| [Open-Meteo Air Quality API](https://open-meteo.com/en/docs/air-quality-api), `domains=cams_global` | **Live.** Fetched successfully from this machine on 2026-10-23 (13:04, 13:20 and 13:32 UTC) | **MODEL FORECAST** (Copernicus Atmosphere Monitoring Service), never an observation | `pm2_5`, `pm10`, `nitrogen_dioxide`, `ozone`, `sulphur_dioxide`, `carbon_monoxide`, all μg/m³, 10 m above ground | 0.4° (~45 km) grid; model output every 3 hours, returned as hourly steps; updated every 12 hours, 5-day forecast (provider documentation) | No API key. Free for non-commercial use (provider documentation). Attribute Open-Meteo and CAMS. |
| Cached historical examples, [`gateway/fixtures/integrity/`](../gateway/fixtures/integrity/) | Used when chosen, or when a live fetch fails in "live, with a labelled fallback" mode | **CACHED HISTORICAL EXAMPLE** | Same as above | Same as above | The exact response text for New Delhi and Chennai, with request URL and capture time (2026-10-23 13:04 UTC) |
| [WHO global air quality guidelines (2021)](https://www.who.int/publications/i/item/9789240034228) | Reference values only | Guideline levels, not limits in any jurisdiction | PM2.5 15, PM10 45, NO₂ 25, SO₂ 40 μg/m³ (24-hour); O₃ 100 μg/m³ (8-hour); CO 4 mg/m³ (24-hour) | Short-term levels are 99th percentiles (about 3 to 4 exceedance days a year) | Values checked on 2026-10-23 against the WHO AQG table reproduced in the [PMC executive summary](https://pmc.ncbi.nlm.nih.gov/articles/PMC12052406/) |

### Rate limits, retries and failure states

The adapter is [`gateway/integrity-sources.mjs`](../gateway/integrity-sources.mjs).

- At most one live request per site per 60 seconds. A repeat within that window reuses the response, and the bundle says so (`reusedRecentResponse`).
- 10-second timeout and a 2 MiB response cap. Redirects are refused.
- Network errors, timeouts and HTTP errors are retried twice, after 250 ms and 500 ms.
- HTTP 429 is not retried. The error carries the `Retry-After` value to the UI.
- Each failure has its own code: `source_timeout`, `source_rate_limited`, `source_http_error`, `source_unavailable`, `source_invalid_json`, `source_error_response`, `source_missing_field`, `source_unit_mismatch`, `source_contract_invalid`, `source_no_past_values`.
- In "live" mode a failure is shown as an error. In the default mode it falls back to the cached example, labelled as such with the live error attached. A cached example is never labelled live.

### Validation applied to every response

- Valid JSON object, not an error body.
- UTC timestamps (`utc_offset_seconds` 0). Strictly increasing hours.
- All six variables present, with series lengths matching the time axis. Values are null or finite numbers; missing values stay null and are never filled.
- Units are μg/m³ (either micro sign is accepted). Anything else, such as ppm, is refused.
- Only hours at or before the retrieval time enter the evidence; forecast hours are dropped.
- The data is stale when the newest kept hour is more than 6 hours old at retrieval. The bundle and UI then say STALE.

### Chemistry kept distinct

PM2.5 and PM10 are particle size fractions, not molecules. NO₂ is not N₂. CO is not CO₂. Ground-level O₃ is not the stratospheric ozone layer. SO₂ forms cooling sulphate aerosol and is not a greenhouse gas. Every value is a concentration near the surface, never an emission rate.

## Labels

| Label | Used in the lab? |
|---|---|
| LIVE OBSERVATION | No. The lab has no station data. |
| MODEL FORECAST | Yes, on every measurement |
| DERIVED ESTIMATE | Yes, for the 24-hour mean |
| CACHED HISTORICAL EXAMPLE | Yes, when the stored response is used |
| SIMULATED DEMO | No simulated values in the lab |
| UNVERIFIED CLAIM | Yes, on every claim |
| INDEPENDENTLY REVIEWED CLAIM | Never. There is no independent reviewer. |
| ON-CHAIN ANCHORED PROOF | Yes, once a digest is anchored. It proves integrity, not truth. |

## Not configured

| Source | Why not | What is needed |
|---|---|---|
| [OpenAQ v3](https://docs.openaq.org/) observed stations | Needs a free API key, and no adapter ships in this build. Bundles record the comparison as `NOT_PERFORMED`. | `OPENAQ_API_KEY` on the gateway, plus an adapter that pairs station hours with model hours |

## Not integrated

Planned in the master brief as later work: Climate TRACE, EU EDGAR, USGS / Water Quality Portal, UNEP GEMStat, NASA FIRMS, World Bank What a Waste, ISRIC SoilGrids, Copernicus Data Space, Global Plastic Watch and Google Earth Engine. Their access notes in the brief, for example that the SoilGrids REST API is paused and that GEMStat reported a service disruption, were not re-checked in this session.

## Existing sources, unchanged

The four pilot connectors (JunkSnap, clearsky, Teesri Shikayat, The Vayu Project) and the Earth intelligence Open-Meteo weather and air reads ([`gateway/place-environment.mjs`](../gateway/place-environment.mjs)) work as before. See the [README](../README.md).
