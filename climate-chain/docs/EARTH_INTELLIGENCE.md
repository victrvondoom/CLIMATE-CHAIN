# Cesium Earth intelligence

The default workspace is now **Satellite climate globe**, at `/#earth`. It uses CesiumJS 1.146 and real tiled satellite imagery. The existing command center and Cascade Review also render their source coordinates through Cesium, retaining their routes and source labels.

## Explore

1. Search a city or port, enter coordinates, choose a preset, or click the globe.
2. Inspect current model weather and air-quality values, valid times, returned model grid location and original data query.
3. Select an hourly pollutant forecast or request the explicit wind-oriented sampling comparison.
4. Request nearby mapped industrial works and power plants. Inspect their OSM evidence or copy a location into a production draft.
5. Enter production activity and sourced emission factors, connect freight legs, and inspect the declared footprint. Missing values keep totals UNKNOWN.
6. Export the inspection or record its source responses and input data in the browser evidence ledger.

## Satellite view

- **Esri World Imagery** is the default satellite/aerial mosaic. Capture dates and resolution vary by place. It is context imagery, not a live weather feed.
- **NASA VIIRS S-NPP** is a dated true-color daily composite from NASA GIBS. Change its image date to inspect a different day; clouds and orbital gaps can obscure the surface. It is not used to infer emissions.
- Reference labels, day/night illumination, zoom, tilt and whole-Earth controls are available. Keyboard arrows rotate the canvas and `+` / `-` zoom. Reduced motion suppresses selection flights.
- The default surface is the WGS84 ellipsoid. A restricted public `VITE_CESIUM_ION_TOKEN` enables the optional Cesium World Terrain toggle at build time. No terrain or building data is claimed without that connection.
- Cesium workers, widgets and assets are served locally from `/cesium/` in both development and the production build. No runtime CDN script is required.

Imagery integration follows the [Cesium imagery-provider API](https://cesium.com/learn/cesiumjs/ref-doc/ArcGisMapServerImageryProvider.html), [official Vite example](https://github.com/CesiumGS/cesium-vite-example), and [NASA GIBS access format](https://nasa-gibs.github.io/gibs-api-docs/access-basics/). Attribution remains visible on the globe.

## Place data and carbon scope

| Layer | Source | Meaning |
| --- | --- | --- |
| Weather | Open-Meteo weather models | Current valid-time temperature, humidity, precipitation and wind, with a 24-hour series |
| Air quality | CAMS via Open-Meteo | Model PM2.5, PM10, AQI and other pollutant concentrations |
| Atmospheric carbon | CAMS greenhouse gases via Open-Meteo | Near-surface modeled CO2 and methane concentrations, with units and valid times |
| Industrial facilities | OpenStreetMap via Overpass | Mapped industrial works and power plants; operator/product only when present in tags |
| Production carbon | User evidence and factors | Declared electricity, process and freight estimates; no default emission factors or assumed factories |

Atmospheric concentration is not a production emissions inventory. Weather and CAMS values are model grid values, not on-site readings. [Open-Meteo documents its models and variables](https://open-meteo.com/en/docs); [air-quality documentation](https://open-meteo.com/en/docs/air-quality-api) specifies CAMS and greenhouse-gas fields. The prototype uses the public, noncommercial endpoints; commercial deployment must use suitable provider access.

Facility discovery is bounded to 25 km and 40 returned features. Empty mapping results do not prove an absence of industry. Provider failure is explicit and keeps production/emissions unknown. OSM points and area centers do not establish ownership, activity, current output or emissions. See [Overpass output semantics](https://dev.overpass-api.de/overpass-doc/en/targets/formats.html) and [OSM attribution](https://www.openstreetmap.org/copyright).

## Wind-oriented evidence lens

An explicit check samples model values at two places along the current modeled wind direction, at the selected distance on either side. Downwind minus upwind is calculated only for available values with matching units, valid times and source products. The returned model grid locations remain inspectable; resolving to the same grid is flagged.

The wind valid time and air valid times are retained separately. This is a contextual sampling transect, not a validated atmospheric dispersion model, local source attribution or a causal test. No avoided carbon claim is generated.

## Supply calculations

Electricity estimate = entered kWh × entered kg CO2e/kWh. Add explicitly entered process emissions, taking care not to count electricity twice. Production intensity divides a complete estimate by positive entered output in its documented unit. Keep all inputs within a common reporting period and scope.

Freight estimate = entered tonnes × approximate great-circle km × entered kg CO2e/tonne-km. The line is not an actual road, shipping or flight itinerary. Missing factors or activities yield UNKNOWN; a separate known subtotal remains explicitly partial. Source notes and evidence dates accompany each site and leg.

Methods: [GHG Protocol activity and factors](https://ghgptechassistance.zendesk.com/hc/en-us/articles/37790958151700-How-do-I-calculate-emissions), [New Zealand Ministry for the Environment freight guidance](https://measuringemissionsguide.environment.govt.nz/8_freight.html). The application supplies no certification or full lifecycle completeness claim.

## Local verification on 23 October 2026

- Frontend: lint, TypeScript/Vite build and 464 tests pass across 66 files.
- Gateway: all 110 tests pass, including fixed hosts, bounded responses/timeouts/cache, partial weather/air failure, geocoding, facility mapping and route validation.
- Real weather, air and greenhouse-gas responses were received. Real geocoding, Esri tiles, NASA tiles and local Cesium assets returned successfully.
- Playwright exercised map selection, satellite/day/date controls, location search, hourly selection, wind comparison, evidence export/recording, production site and route creation, unknown-factor handling, reload persistence, and mobile navigation/overflow.
- Live nearby facility discovery returned an explicit provider timeout during verification; no live factory inventory is claimed. Deterministic provider tests cover successful mapped results. UI success-path checks use explicitly synthetic routed data.
- Production/freight browser checks used isolated, explicitly synthetic inputs; they do not establish actual factory emissions.
- Cesium adds a large lazy-loaded JavaScript chunk; the build reports its size warning. External imagery and data require provider availability. Browser satellite imagery was visually inspected; terrain without a configured token was not exercised.

The verified session runs at <http://localhost:8081/#earth>. A normal `./start.ps1` restart uses port 8080 unless `PORT` is configured.
