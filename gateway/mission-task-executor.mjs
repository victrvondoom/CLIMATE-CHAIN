// Local mission task adapters. Network access is confined to the connector
// registry and the reviewed aggregate ClearSky contract.

import { executeAllowlistedTask, isAllowedMissionConnectorInput, MISSION_CONNECTOR_OPERATIONS, MISSION_VAYU_CITY_PRESETS } from './mission-engine.mjs';
import { CLEARSKY_AGGREGATE_FIELDS } from './connectors/registry.mjs';

export async function executeMissionTask(type, input, { signal, connectorRegistry } = {}) {
  if (type !== 'climate.connector_snapshot') return executeAllowlistedTask(type, input);

  if (!isAllowedMissionConnectorInput(input)) {
    const error = new Error('The requested mission connector input is outside the reviewed source allowlist.');
    error.code = 'CONNECTOR_NOT_ALLOWED';
    throw error;
  }
  if (!connectorRegistry || typeof connectorRegistry.read !== 'function') {
    const error = new Error('The local connector registry is unavailable to this worker.');
    error.code = 'CONNECTOR_UNAVAILABLE';
    throw error;
  }

  const operation = MISSION_CONNECTOR_OPERATIONS[input.connector];
  const cityPreset = input.connector === 'vayu' ? MISSION_VAYU_CITY_PRESETS[input.city] : null;
  const query = cityPreset ? { lat: cityPreset.lat, lng: cityPreset.lng } : {};
  const result = await connectorRegistry.read(input.connector, operation, { query, signal });
  const data = input.connector === 'clearsky'
    ? Object.fromEntries(CLEARSKY_AGGREGATE_FIELDS
      .filter((key) => Object.hasOwn(result.data, key))
      .map((key) => [key, result.data[key]]))
    : {
      city: input.city,
      asOf: result.data.asOf,
      sourceMode: result.data.mode,
      unit: 'µg/m³',
      measurements: result.data.hours.filter((hour) => Number.isFinite(hour.pm25)).slice(-24)
        .map((hour) => ({ at: hour.t, pm25: hour.pm25, kind: hour.kind })),
    };
  const isVayu = input.connector === 'vayu';
  return {
    output: {
      classification: 'SOURCE_SNAPSHOT',
      connector: input.connector,
      operation,
      schema: result.provenance.schema,
      sourceMode: isVayu ? result.data.mode : result.provenance.mode,
      fetchedAt: result.provenance.fetchedAt,
      sourceProvenance: result.provenance,
      data,
    },
    validation: [
      { check: `response passed the configured ${isVayu ? 'Vayu observation' : 'ClearSky statistics'} schema`, passed: true },
      { check: isVayu
        ? 'query uses a configured city preset and durable output omits coordinates, place/station identifiers, and free-text rationale'
        : 'durable payload is limited to aggregate ClearSky statistics', passed: true },
      ...(isVayu ? [{ check: 'at most 24 timestamped PM2.5 samples are retained with the source-reported data kind', passed: true }] : []),
    ],
    uncertainty: isVayu
      ? 'The connector validates response shape and transport provenance. PM2.5 samples retain Vayu-reported observed, forecast, pattern, or model context; no independent measurement verification is performed.'
      : 'The connector validated response shape and transport provenance. It does not independently verify the upstream measurements, reporting methods, or operational meaning of each field.',
    tool: `connector.read.${input.connector}.${operation}`,
    provenance: result.provenance,
  };
}
