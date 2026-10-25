// Climate Chain gateway: service registry and upstream adapters.
// Each upstream is one of the four merged projects. Every fetch is
// time-boxed; on failure the gateway serves a clearly-labelled mock so
// the unified frontend never shows an invented number as if it were real.

export const SERVICES = {
  junksnap: {
    label: 'DumpWatch',
    domain: 'Waste',
    env: 'JUNKSNAP_API_URL',
    url: 'https://d2s7tf4ua41hzf.cloudfront.net',
    health: '/healthz',
  },
  clearsky: {
    label: 'AshAlert',
    domain: 'Fire',
    env: 'CLEARSKY_API_URL',
    url: 'https://h5n589so32.execute-api.ap-south-1.amazonaws.com',
    health: '/api/stats',
  },
  teesri: {
    label: 'TapAlert',
    domain: 'Water',
    env: 'TEESRI_API_URL',
    url: 'https://eirioqqhvtvve3aw5xhpje2wju0jztrl.lambda-url.ap-south-1.on.aws',
    health: '/api/state',
  },
  vayu: {
    label: 'AirPulse',
    domain: 'Air',
    env: 'VAYU_API_URL',
    url: 'https://niu33luxo8.execute-api.ap-south-1.amazonaws.com',
    health: '/v1/health',
  },
};

export function serviceUrl(name) {
  const s = SERVICES[name];
  return (process.env[s.env] || s.url).replace(/\/$/, '');
}

const UPSTREAM_TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS || 7000);

export async function fetchUpstream(name, path, init = {}) {
  const base = serviceUrl(name);
  const url = base + path;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    return { ok: res.ok, status: res.status, url, body };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Normalized adapters. These convert each project's native response shape
// into the unified Climate Chain model so one frontend can render all four.
// ---------------------------------------------------------------------------

export function normalizeWaste(featureCollection) {
  const features = (featureCollection && featureCollection.features) || [];
  return features.map((f) => {
    const p = f.properties || {};
    const [lng, lat] = f.geometry && f.geometry.coordinates ? f.geometry.coordinates : [null, null];
    const backers = p.backers || {};
    return {
      id: p.site_id,
      lat,
      lng,
      reportType: p.report_type,
      context: p.context,
      status: p.status,
      verification: p.verification,
      reportCount: p.report_count,
      verifiedCount: p.verified_count,
      firstReportedAt: p.first_reported_at || null,
      lastReportedAt: p.last_reported_at || null,
      backers: { count: backers.vote_count ?? backers.count ?? p.corroborations ?? 0, needed: backers.needed ?? 10 },
      place: p.area || p.ward || null,
      photoUrl: p.photo_url || null,
      source: 'junksnap',
    };
  });
}

export function normalizeFire(stats) {
  return {
    farmers: stats.farmers,
    fields: stats.fields,
    acresRegistered: stats.acres_registered,
    acresBooked: stats.acres_booked,
    acresCleared: stats.acres_cleared,
    tonnesBooked: stats.tonnes_booked,
    tonnesDelivered: stats.tonnes_delivered,
    payoutsEstimatedInr: stats.payouts_estimated_inr,
    demoPrices: typeof stats.demo_prices === 'boolean' ? stats.demo_prices : null,
    redFields: stats.red_fields,
    yellowFields: stats.yellow_fields,
    alertsSent: stats.alerts_sent,
    fieldsSavedAfterAlert: typeof stats.fields_saved_after_alert === 'number' ? stats.fields_saved_after_alert : null,
    bookings: stats.bookings,
    bookingsDone: stats.bookings_done,
    today: stats.today,
    source: 'clearsky',
  };
}

export function normalizeWater(state) {
  const homes = (state && state.homes) || [];
  if (!Array.isArray(homes)) throw new TypeError('TapAlert state homes must be an array');
  if (homes.some((home) => !home || typeof home !== 'object' || Array.isArray(home))) {
    throw new TypeError('TapAlert state home records must be objects');
  }
  const statusCounts = homes.reduce((counts, home) => {
    if (home.reported) counts.reported += 1;
    else if (home.warned) counts.warned += 1;
    else if (home.in_ring) counts.inRing += 1;
    else counts.outside += 1;
    return counts;
  }, { reported: 0, warned: 0, inRing: 0, outside: 0 });
  return {
    reported: homes.filter((h) => h.reported).length,
    warned: homes.filter((h) => h.warned).length,
    inRing: homes.filter((h) => h.in_ring).length,
    total: homes.length,
    statusCounts,
    ward: 'B ward, Dongri, Mumbai',
    source: 'teesri',
  };
}

export function normalizeAir(today) {
  if (!today || typeof today !== 'object') throw new TypeError('AirPulse response must be an object');
  const hours = (today && today.hours) || [];
  // Only hours with a real value count. Prefer the newest observed monitor
  // hour; if none has arrived yet, the newest valued hour of any kind
  // (still AirPulse's own real data, never invented).
  const valued = hours.filter((h) => typeof h.pm25 === 'number');
  const observed = valued.filter((h) => h.kind === 'observed');
  const latest = observed.length ? observed[observed.length - 1] : valued.length ? valued[valued.length - 1] : null;
  const now = latest ? latest.pm25 : null;
  return {
    place: today.place ? { name: today.place.name, lat: today.place.lat, lng: today.place.lng } : null,
    asOf: today.asOf,
    mode: today.mode,
    provenance: today.prov ? {
      mode: today.prov.mode,
      source: today.prov.source,
      stationId: today.prov.stationId || null,
      stationName: today.prov.stationName || null,
      distanceKm: Number.isFinite(today.prov.distanceKm) ? today.prov.distanceKm : null,
      observedAt: today.prov.observedAt || null,
      fetchedAt: today.prov.fetchedAt || null,
      asOf: today.prov.asOf || today.asOf || null,
      ageMinutes: Number.isFinite(today.prov.ageMinutes) ? today.prov.ageMinutes : null,
      simulated: today.prov.simulated === true,
    } : null,
    pm25Now: now,
    pm25Max24h: valued.length ? Math.max(...valued.map((h) => h.pm25)) : null,
    hours: valued.map((h) => ({ t: h.t, pm25: h.pm25, kind: h.kind })),
    source: 'vayu',
  };
}

export function pm25Severity(pm25) {
  if (pm25 == null) return { level: 'unknown', label: 'No reading' };
  if (pm25 <= 35) return { level: 'good', label: 'Good' };
  if (pm25 <= 75) return { level: 'moderate', label: 'Moderate' };
  if (pm25 <= 115) return { level: 'poor', label: 'Poor' };
  if (pm25 <= 150) return { level: 'verypoor', label: 'Very poor' };
  return { level: 'severe', label: 'Severe' };
}

// ---------------------------------------------------------------------------
// The cross-project feed: where the four projects map onto each other.
// Every rule names the two modules it joins, so the mapping stays auditable.
// ---------------------------------------------------------------------------

export function buildCrossFeed({ waste, fire, water, air }, opts = {}) {
  const feed = [];
  const push = (severity, modules, title, detail) => feed.push({ severity, modules, title, detail, key: modules.join('+') + ':' + title });

  const openWaste = waste.filter((w) => w.status === 'open');
  if (openWaste.length > 0) {
    push(
      openWaste.length >= 3 ? 'high' : 'medium',
      ['waste'],
      `${openWaste.length} open waste dumps awaiting clearance`,
      'DumpWatch sites in the Jodhpur pilot. Each needs 10 resident backers to become verified evidence for a cited letter.',
    );
  }

  // Regional AshAlert totals and a selected AirPulse place have no shared location
  // or time key. Keep them as separate signals until a source-backed join exists.
  if (fire && fire.redFields > 0) {
    push('medium', ['fire'], `${fire.redFields} fields are marked at burn risk`, 'Regional AshAlert count. Field locations and per-field timestamps are not part of this connected aggregate.');
  }

  if (water && water.reported >= 3) {
    push(
      'high',
      ['water'],
      `Water tripwire armed: ${water.reported} homes reported dirty water`,
      'TapAlert warns every enrolled home within 250 m of the third complaint; the case closes only when residents confirm clean taps.',
    );
  }

  if (fire && fire.acresCleared > 0) {
    push('low', ['fire'], `${fire.acresCleared} acres reported cleared`, 'AshAlert season aggregate; this gateway does not independently verify avoided burning or resulting air-quality changes.');
  }

  if (air && air.pm25Now != null && air.pm25Now > 115) {
    push('high', ['air'], `PM2.5 reading is ${air.pm25Now} µg/m³`, 'AirPulse reading at the selected place. Use its monitor name, distance, age and mode before interpreting exposure.');
  }

  return feed;
}

export function severityRank(s) {
  return { high: 0, medium: 1, low: 2, unknown: 3 }[s] ?? 4;
}
