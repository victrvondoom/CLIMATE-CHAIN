import { describe, expect, it } from 'vitest';
import type { Overview } from '../types';
import { buildDurableMissionDefinition } from './MissionRuntime';

const overview = {
  asOf: '2026-10-22T04:00:00.000Z',
  city: { name: 'Jodhpur', lat: 26.29, lng: 73.02 },
  sources: {
    junksnap: { mode: 'live', label: 'JunkSnap', provenance: { source: 'junksnap', operation: 'sites', schema: 'sites', mode: 'source_snapshot', connection: 'connected', transport: 'http', url: 'https://example.test/sites', fetchedAt: '2026-10-22T04:00:00.000Z', elapsedMs: 10, attempts: 1, requestId: null } },
    clearsky: { mode: 'mock', label: 'ClearSky', provenance: null },
    teesri: { mode: 'live', label: 'Teesri Shikayat', provenance: { source: 'teesri', operation: 'state', schema: 'state', mode: 'source_snapshot', connection: 'connected', transport: 'http', url: 'https://example.test/api/state', fetchedAt: '2026-10-22T04:00:00.000Z', elapsedMs: 10, attempts: 1, requestId: null } },
    vayu: { mode: 'live', label: 'The Vayu Project', provenance: { source: 'vayu', operation: 'today', schema: 'today', mode: 'model', connection: 'connected', transport: 'http', url: 'https://example.test/v1/today', fetchedAt: '2026-10-22T04:00:00.000Z', elapsedMs: 10, attempts: 1, requestId: null } },
  },
  waste: { open: 3, verified: 1, sites: [] },
  fire: { farmers: 0, fields: 0, acresRegistered: 0, acresBooked: 0, acresCleared: 10, tonnesBooked: 0, tonnesDelivered: 0, payoutsEstimatedInr: 0, redFields: 0, yellowFields: 0, alertsSent: 0, fieldsSavedAfterAlert: null, bookings: 0, bookingsDone: 0, today: '2026-10-22', source: 'clearsky' },
  water: { reported: 0, warned: 7, inRing: 0, total: 0, statusCounts: { reported: 0, warned: 7, inRing: 0, outside: 0 }, ward: 'Ward 4', caseOpen: false, source: 'teesri' },
  air: { pm25Now: 42, pm25Max24h: 52, asOf: '2026-10-22T04:00:00.000Z', mode: 'model', provenance: { mode: 'model', source: 'model', stationId: 'private-station-id', stationName: 'private station name', distanceKm: null, observedAt: null, fetchedAt: '2026-10-22T04:00:00.000Z', asOf: '2026-10-22T03:30:00.000Z', ageMinutes: 30, simulated: true }, place: { name: 'private place name', lat: 26.29, lng: 73.02 }, hours: [], severity: { level: 'low', label: 'Low' }, source: 'vayu' },
  feed: [],
} as Overview;

describe('buildDurableMissionDefinition', () => {
  it('builds a dependency-checked report chain from scoped source values', () => {
    const definition = buildDurableMissionDefinition('Ward review', 'Ward 4', overview);
    expect(definition.title).toBe('Ward review — source review');
    expect(definition.tasks.map(({ id, type }) => [id, type])).toEqual([
      ['observations', 'climate.observation_summary'],
      ['report', 'report.render'],
    ]);
    expect(definition.tasks[1].dependsOn).toEqual(['observations']);
    const observations = definition.tasks[0].input.observations as { metric: string; unit: string; sourceId: string; sourceStatus: string; observedAt: string; geography: string }[];
    expect(observations).toHaveLength(4);
    expect(observations.map((row) => [row.metric, row.unit])).toContainEqual(['pm25', 'ug/m3']);
    expect(observations.every((row) => row.observedAt.length > 0 && row.geography.length > 0)).toBe(true);
    const airObservation = observations.find((row) => row.metric === 'pm25');
    expect(airObservation).toMatchObject({ sourceId: 'overview:vayu', geography: 'Jodhpur' });
    expect(JSON.stringify(definition.tasks).includes('private-station-id')).toBe(false);
    expect(JSON.stringify(definition.tasks).includes('private station name')).toBe(false);
    expect(JSON.stringify(definition.tasks).includes('private place name')).toBe(false);
  });

  it('labels disconnected fallback and model-mode air as simulated instead of measured', () => {
    const definition = buildDurableMissionDefinition('', '', overview);
    const observations = definition.tasks[0].input.observations as { metric: string; sourceStatus: string }[];
    expect(observations.find((row) => row.metric === 'cleared_land')?.sourceStatus).toBe('simulated');
    expect(observations.find((row) => row.metric === 'pm25')?.sourceStatus).toBe('simulated');
    expect(observations.find((row) => row.metric === 'open_waste_sites')?.sourceStatus).toBe('live');
    expect(definition.title).toBe('Climate intelligence — source review');
  });

  it('adds a worker-side ClearSky refresh only when the aggregate feed is connected', () => {
    const liveOverview = {
      ...overview,
      sources: { ...overview.sources, clearsky: { ...overview.sources.clearsky, mode: 'live' as const, connection: 'connected' as const } },
    };
    const definition = buildDurableMissionDefinition('Ward review', 'Ward 4', liveOverview);
    expect(definition.tasks.map(({ id, type }) => [id, type])).toEqual([
      ['clearsky', 'climate.connector_snapshot'],
      ['observations', 'climate.observation_summary'],
      ['report', 'report.render'],
    ]);
    expect(definition.tasks[0].input).toEqual({ connector: 'clearsky' });
    expect(definition.tasks[2].dependsOn).toEqual(['observations', 'clearsky']);
    expect(definition.tasks[2].input.sections).toEqual(expect.arrayContaining([
      expect.objectContaining({ heading: 'Fresh ClearSky aggregate snapshot and provenance' }),
    ]));
  });

  it('adds a Vayu city refresh only when connected and keeps it scoped to the configured city', () => {
    const liveOverview = {
      ...overview,
      sources: { ...overview.sources, vayu: { ...overview.sources.vayu, mode: 'live' as const, connection: 'connected' as const } },
    };
    const definition = buildDurableMissionDefinition('Ward review', 'Ward 4', liveOverview);
    expect(definition.tasks.map(({ id, type }) => [id, type])).toEqual([
      ['vayu', 'climate.connector_snapshot'],
      ['observations', 'climate.observation_summary'],
      ['report', 'report.render'],
    ]);
    expect(definition.tasks[0].input).toEqual({ connector: 'vayu', city: 'jodhpur' });
    expect(definition.tasks[2].dependsOn).toEqual(['observations', 'vayu']);
    expect(definition.tasks[2].input.sections).toEqual(expect.arrayContaining([
      expect.objectContaining({ heading: 'Fresh Vayu city PM2.5 samples with reported data kind' }),
    ]));
  });
});
