// Mock data for offline fallback. The four merged projects all insist that
// no made-up number is ever shown as real, so every mock response carries
// mode: 'mock' and the frontend badges it as SIMULATED.

export function mockWaste() {
  const sites = [
    ['site_mock_1', 26.266972, 73.0285317, 'waste_dump', 'vacant_plot', 'open', 4],
    ['site_mock_2', 26.2812, 73.0301, 'overflowing_bin', 'street', 'open', 1],
    ['site_mock_3', 26.2915, 73.0512, 'waste_dump', 'behind_market', 'cleared', 12],
    ['site_mock_4', 26.2388, 73.0097, 'construction_debris', 'road_edge', 'open', 7],
    ['site_mock_5', 26.3039, 73.0206, 'overflowing_bin', 'park', 'open', 2],
  ];
  return {
    type: 'FeatureCollection',
    features: sites.map(([id, lat, lng, reportType, context, status, backers]) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [lng, lat] },
      properties: {
        site_id: id,
        report_type: reportType,
        context,
        status,
        verification: backers >= 10 ? 'verified' : 'unverified',
        report_count: backers,
        verified_count: backers,
        corroborations: backers,
        backers: { needed: 10, vote_count: backers },
      },
    })),
  };
}

export function mockFire() {
  return {
    farmers: 61,
    fields: 63,
    acres_registered: 581,
    acres_booked: 215,
    acres_cleared: 55,
    tonnes_booked: 537.5,
    tonnes_delivered: 137.5,
    payouts_estimated_inr: 829760,
    red_fields: 10,
    yellow_fields: 0,
    alerts_sent: 5,
    bookings: 21,
    bookings_done: 2,
    today: new Date().toISOString().slice(0, 10),
    demo_prices: true,
  };
}

export function mockWater() {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUV';
  const homes = letters.split('').map((l, i) => ({
    id: `sim-${l}`,
    sim: true,
    label: `Simulated home ${l}`,
    lat: 19.1157653 + (i % 6) * 0.0006 - 0.0015,
    lon: 72.8365800 + Math.floor(i / 6) * 0.0006 - 0.0015,
    reported: ['A', 'B', 'C'].includes(l),
    member: true,
    in_ring: i < 23,
    warned: i < 23,
    checkin: null,
    messages: [],
  }));
  return { homes, case: { open: true }, simulated: true };
}

export function mockAir() {
  const now = new Date();
  const hours = [];
  let pm = 95;
  for (let i = 23; i >= 0; i--) {
    pm = Math.max(30, Math.min(210, pm + Math.sin(i * 1.3) * 18 + (i % 5) * 4 - 6));
    hours.push({ t: new Date(now - i * 3600e3).toISOString(), pm25: Math.round(pm * 10) / 10, kind: i < 5 ? 'forecast' : 'observed' });
  }
  return {
    schemaVersion: 1,
    place: { id: 'gps', name: 'Your location', kind: 'other', lat: 28.6, lng: 77.2 },
    asOf: now.toISOString(),
    mode: 'mock',
    hours,
  };
}
