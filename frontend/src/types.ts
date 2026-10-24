// Unified Climate Chain data model. Every module speaks these types,
// which the gateway normalizes from each project's native API.

export type SourceMode = 'live' | 'mock';
export type ModuleId = 'waste' | 'fire' | 'water' | 'air';

export interface SourceStatus {
  name: string;
  label: string;
  domain: string;
  status: string;
  http: number;
  checkedAt?: string;
  latencyMs?: number | null;
  lastCheckAt?: string | null;
  lastSuccessAt?: string | null;
  error?: { code: string; message: string; status?: number } | null;
}

export interface WasteSite {
  id: string;
  lat: number | null;
  lng: number | null;
  reportType: string;
  context: string;
  status: string;
  verification: string;
  reportCount: number;
  verifiedCount: number;
  firstReportedAt?: string | null;
  lastReportedAt?: string | null;
  backers: { count: number; needed: number };
  source: 'junksnap';
}

export interface FireStats {
  farmers: number;
  fields: number;
  acresRegistered: number;
  acresBooked: number;
  acresCleared: number;
  tonnesBooked: number;
  tonnesDelivered: number;
  payoutsEstimatedInr: number;
  demoPrices?: boolean | null;
  redFields: number;
  yellowFields: number;
  alertsSent: number;
  fieldsSavedAfterAlert?: number | null;
  bookings: number;
  bookingsDone: number;
  today: string;
  source: 'clearsky';
}

export interface WaterState {
  reported: number;
  warned: number;
  inRing: number;
  total: number;
  statusCounts: { reported: number; warned: number; inRing: number; outside: number };
  ward: string;
  caseOpen: boolean;
  source: 'teesri';
}

export interface AirNow {
  place: { name: string; lat: number; lng: number } | null;
  asOf: string;
  mode: string;
  provenance?: {
    mode: string;
    source: string;
    stationId: string | null;
    stationName: string | null;
    distanceKm: number | null;
    observedAt: string | null;
    fetchedAt: string | null;
    asOf: string | null;
    ageMinutes: number | null;
    simulated: boolean;
  } | null;
  pm25Now: number | null;
  pm25Max24h: number | null;
  hours: { t: string; pm25: number; kind: string }[];
  severity: { level: string; label: string };
  source: 'vayu';
}

export interface CascadeResponse {
  demo?: boolean;
  assessment: {
    status: string;
    candidate: boolean;
    relationship: 'spatiotemporal_proximity_lead';
    causality: 'not_assessed';
    thresholds: { radiusKm: number; timeWindowHours: number };
    checks: {
      bothSourcesObserved: boolean;
      nearestMonitorWithinRadius: boolean | null;
      observationsWithinTimeWindow: boolean | null;
    };
    coverage: {
      score: number;
      availableDimensions: number;
      totalDimensions: number;
      dimensions: {
        observedSources: boolean;
        monitorDistance: boolean;
        reportAndReadingTimes: boolean;
      };
      meaning: string;
    };
    proximity: {
      nearestMonitorDistanceKm: number | null;
      distanceMeaning: string;
      temporalGapHours: number | null;
    };
    explanation: string;
  };
  evidence: {
    schemaVersion: number;
    capturedAt: string;
    site: {
      source: string;
      sourceUrl: string | null;
      sourceId: string | null;
      status: string | null;
      verification: string | null;
      reportCount: number | null;
      firstReportedAt: string | null;
      lastReportedAt: string | null;
      location: { lat: number; lng: number; precision: string } | null;
      sourceMode: string;
    };
    air: {
      source: string;
      sourceUrl: string | null;
      queryPlace: { name: string; lat: number; lng: number } | null;
      pm25: number | null;
      unit: string;
      provenance: AirNow['provenance'];
      upstreamMode: string;
    };
    assessment: CascadeResponse['assessment'];
  };
  manifest: {
    schemaVersion: number;
    id: string;
    capturedAt: string;
    evidence: CascadeResponse['evidence'];
    integrity: { algorithm: string; digest: string; scope: string; limitation: string };
  };
  sources: { junksnap: string; vayu: string };
}

export interface FeedItem {
  severity: 'high' | 'medium' | 'low';
  modules: ModuleId[];
  title: string;
  detail: string;
}

export interface Overview {
  asOf: string;
  city: { lat: number; lng: number; name: string };
  sources: Record<'junksnap' | 'clearsky' | 'teesri' | 'vayu', {
    mode: SourceMode;
    label: string;
    connection?: 'connected' | 'disconnected' | 'contract_invalid';
    provenance?: { source: string; operation: string; schema: string; mode: string; connection: 'connected'; transport: string; url: string; fetchedAt: string; elapsedMs: number; attempts: number; requestId: string | null; cacheHit?: boolean } | null;
    error?: { code: string; message: string } | null;
  }>;
  waste: { sites: WasteSite[]; open: number; verified: number };
  fire: FireStats;
  water: WaterState;
  air: AirNow;
  feed: FeedItem[];
}
