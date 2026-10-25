import type { Overview } from '../types';

// Placeholder figures shown before the first fetch or when offline. Every source is marked
// 'mock' (SIMULATED) and the air series is marked modelled/simulated: none of this is live or observed data.

export const DEFAULT_OVERVIEW: Overview = {
  asOf: new Date().toISOString(),
  city: { lat: 28.6139, lng: 77.2090, name: 'Delhi' },
  sources: {
    junksnap: { mode: 'mock', label: 'JunkSnap API' },
    clearsky: { mode: 'mock', label: 'ClearSky Hub' },
    teesri: { mode: 'mock', label: 'Teesri Shikayat Bot' },
    vayu: { mode: 'mock', label: 'The Vayu Project' }
  },
  waste: {
    sites: [
      {
        id: 'delhi-anand-vihar',
        lat: 28.6469,
        lng: 77.3164,
        reportType: 'Illegal Waste Dump',
        context: 'Open vacant lot near transit terminal',
        status: 'open',
        verification: 'verified',
        reportCount: 14,
        verifiedCount: 12,
        backers: { count: 12, needed: 10 },
        source: 'junksnap'
      },
      {
        id: 'delhi-ghazipur',
        lat: 28.6235,
        lng: 77.3292,
        reportType: 'Debris & Mixed Plastic Waste',
        context: 'Perimeter canal road',
        status: 'open',
        verification: 'unverified',
        reportCount: 6,
        verifiedCount: 4,
        backers: { count: 6, needed: 10 },
        source: 'junksnap'
      }
    ],
    open: 4,
    verified: 1
  },
  fire: {
    farmers: 61,
    fields: 63,
    acresRegistered: 581,
    acresBooked: 215,
    acresCleared: 55,
    tonnesBooked: 537.5,
    tonnesDelivered: 137.5,
    payoutsEstimatedInr: 829760,
    redFields: 10,
    yellowFields: 2,
    alertsSent: 5,
    fieldsSavedAfterAlert: 55,
    bookings: 21,
    bookingsDone: 2,
    today: new Date().toISOString().slice(0, 10),
    source: 'clearsky'
  },
  water: {
    reported: 6,
    warned: 23,
    inRing: 23,
    total: 23,
    statusCounts: { reported: 6, warned: 23, inRing: 23, outside: 0 },
    ward: 'Ward 12',
    caseOpen: true,
    source: 'teesri'
  },
  air: {
    place: { name: 'Delhi & NCR', lat: 28.6139, lng: 77.2090 },
    asOf: new Date().toISOString(),
    mode: 'mock',
    pm25Now: 82.4,
    pm25Max24h: 146.2,
    hours: [
      { t: '00:00', pm25: 68.2, kind: 'modelled' },
      { t: '04:00', pm25: 75.1, kind: 'modelled' },
      { t: '08:00', pm25: 112.4, kind: 'modelled' },
      { t: '12:00', pm25: 98.7, kind: 'modelled' },
      { t: '16:00', pm25: 88.3, kind: 'modelled' },
      { t: '20:00', pm25: 82.4, kind: 'modelled' }
    ],
    severity: { level: 'high', label: 'Unhealthy' },
    source: 'vayu',
    provenance: {
      mode: 'mock',
      source: 'placeholder',
      stationId: null,
      stationName: 'Placeholder (no monitor)',
      distanceKm: null,
      observedAt: null,
      fetchedAt: null,
      asOf: new Date().toISOString(),
      ageMinutes: null,
      simulated: true
    }
  },
  feed: [
    {
      severity: 'high',
      modules: ['waste'],
      title: '4 open waste dumps awaiting clearance',
      detail: 'JunkSnap pilot sites identified in active urban corridor. Requires community backers before municipal notice.'
    },
    {
      severity: 'high',
      modules: ['water'],
      title: 'Water tripwire armed: 6 homes reported dirty water',
      detail: 'Teesri Shikayat warning broadcast to 23 enrolled households within 250m of contamination report.'
    },
    {
      severity: 'medium',
      modules: ['fire'],
      title: '10 fields marked at burn risk',
      detail: 'ClearSky satellite radar flagged stubble burning risk in Punjab corridor. Straw baler teams queued.'
    },
    {
      severity: 'low',
      modules: ['fire'],
      title: '55 acres reported cleared without fires',
      detail: 'Placeholder figures: baler delivery and ₹8.29L conditional farmer payouts are example values.'
    }
  ]
};
