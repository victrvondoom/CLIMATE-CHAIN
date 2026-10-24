import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  fetchHistoricalDatasets,
  fetchHistoricalTimeline,
  fetchHistoricalEvents,
  fetchObservationEvidence,
  type HistoricalDatasetMeta,
  type HistoricalObservation,
  type PolicyEvent,
  type ObservationEvidenceManifest
} from '../api';
import './timeline.css';

interface ClimateTimelineProps {
  onSendToFirewall?: (evidence: ObservationEvidenceManifest) => void;
}

type IndicatorType = 'temperature_anomaly' | 'co2_concentration' | 'ch4_concentration' | 'renewable_share';

const INDICATORS: { id: IndicatorType; label: string; unit: string; range: string; agency: string }[] = [
  {
    id: 'temperature_anomaly',
    label: 'Global Surface Temperature Anomaly',
    unit: '°C (vs 1901-2000)',
    range: '1880–2026 (Gap 1826–1879)',
    agency: 'NOAA NCEI / NASA GISS GISTEMP v4'
  },
  {
    id: 'co2_concentration',
    label: 'Atmospheric Carbon Dioxide (CO₂)',
    unit: 'ppm',
    range: '1832–2026 (Gap 1826–1831)',
    agency: 'Law Dome Ice Core / NOAA Mauna Loa Keeling Record'
  },
  {
    id: 'ch4_concentration',
    label: 'Atmospheric Methane (CH₄)',
    unit: 'ppb',
    range: '1841–2026 (Gap 1826–1840)',
    agency: 'Law Dome Ice Core / NOAA GML Marine Network'
  },
  {
    id: 'renewable_share',
    label: 'Renewable Electricity Generation Share',
    unit: '% of electricity',
    range: '1965–2026 (Gap 1826–1964)',
    agency: 'IRENA / Energy Institute Statistical Review'
  }
];

export function ClimateTimeline({ onSendToFirewall }: ClimateTimelineProps) {
  const [selectedIndicator, setSelectedIndicator] = useState<IndicatorType>('temperature_anomaly');
  const [selectedYear, setSelectedYear] = useState<number>(2024);
  const [datasets, setDatasets] = useState<HistoricalDatasetMeta[]>([]);
  const [timelineData, setTimelineData] = useState<HistoricalObservation[]>([]);
  const [events, setEvents] = useState<PolicyEvent[]>([]);
  const [activeEvidence, setActiveEvidence] = useState<ObservationEvidenceManifest | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [showCatalog, setShowCatalog] = useState<boolean>(false);

  useEffect(() => {
    let active = true;
    setLoading(true);

    Promise.all([
      fetchHistoricalDatasets(),
      fetchHistoricalTimeline(selectedIndicator, 1826, 2026),
      fetchHistoricalEvents()
    ])
      .then(([dsRes, timeRes, evRes]) => {
        if (!active) return;
        setDatasets(dsRes.datasets || []);
        setTimelineData(timeRes.observations || []);
        setEvents(evRes.events || []);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Failed to load historical climate data', err);
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [selectedIndicator]);

  // Load evidence manifest whenever selected year changes
  useEffect(() => {
    let active = true;
    fetchObservationEvidence(selectedIndicator, selectedYear)
      .then((manifest) => {
        if (active) setActiveEvidence(manifest);
      })
      .catch(() => {
        if (active) setActiveEvidence(null);
      });

    return () => {
      active = false;
    };
  }, [selectedIndicator, selectedYear]);

  const currentObservation = useMemo(() => {
    return timelineData.find((o) => o.year === selectedYear) || null;
  }, [timelineData, selectedYear]);

  // SVG Chart Dimensions & Computations
  const chartWidth = 900;
  const chartHeight = 280;
  const padding = { top: 25, right: 35, bottom: 40, left: 60 };
  const innerWidth = chartWidth - padding.left - padding.right;
  const innerHeight = chartHeight - padding.top - padding.bottom;

  const validObservations = useMemo(() => {
    return timelineData.filter((o) => !o.is_gap && o.value !== null);
  }, [timelineData]);

  const { minVal, maxVal } = useMemo(() => {
    if (validObservations.length === 0) return { minVal: 0, maxVal: 100 };
    let min = Infinity;
    let max = -Infinity;
    for (const o of validObservations) {
      if (o.value !== null) {
        const lower = o.value - (o.uncertainty || 0);
        const upper = o.value + (o.uncertainty || 0);
        if (lower < min) min = lower;
        if (upper > max) max = upper;
      }
    }
    const margin = (max - min) * 0.1 || 1;
    return { minVal: min - margin, maxVal: max + margin };
  }, [validObservations]);

  const getX = useCallback((year: number) => {
    return padding.left + ((year - 1826) / (2026 - 1826)) * innerWidth;
  }, [padding.left, innerWidth]);

  const getY = useCallback((val: number) => {
    if (maxVal === minVal) return padding.top + innerHeight / 2;
    return padding.top + innerHeight - ((val - minVal) / (maxVal - minVal)) * innerHeight;
  }, [maxVal, minVal, padding.top, innerHeight]);

  // Build SVG Path for line and uncertainty area
  const { linePath, areaPath } = useMemo(() => {
    if (validObservations.length < 2) return { linePath: '', areaPath: '' };
    
    let path = '';
    let upperPath = '';
    let lowerPath = '';

    validObservations.forEach((o, idx) => {
      if (o.value === null) return;
      const x = getX(o.year);
      const y = getY(o.value);
      const unc = o.uncertainty || 0;
      const yTop = getY(o.value + unc);
      const yBottom = getY(o.value - unc);

      if (idx === 0) {
        path += `M ${x} ${y}`;
        upperPath += `M ${x} ${yTop}`;
        lowerPath = `L ${x} ${yBottom}`;
      } else {
        path += ` L ${x} ${y}`;
        upperPath += ` L ${x} ${yTop}`;
        lowerPath = ` L ${x} ${yBottom}` + lowerPath;
      }
    });

    return {
      linePath: path,
      areaPath: upperPath + lowerPath + ' Z'
    };
  }, [validObservations, getX, getY]);

  const handleDownloadManifest = () => {
    if (!activeEvidence) return;
    const blob = new Blob([JSON.stringify(activeEvidence, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeEvidence.evidence_id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="ctl-container">
      {/* Header Panel */}
      <div className="ctl-header-panel">
        <h1 className="ctl-title">Climate Intelligence Timeline — 200 Years of Environmental Evidence</h1>
        <p className="ctl-subtitle">
          Explore validated historical climate measurements, official meteorological series, and documented policy interventions from 1826 to 2026.
          All observations are traceable to peer-reviewed and national agency repositories (NOAA, NASA GISS, CSIRO/AAD Law Dome, IRENA, CPCB).
          Historical data gaps are preserved explicitly without synthetic model extrapolation.
        </p>

        <div className="ctl-badges-row">
          <span className="ctl-badge ctl-badge-gold">8 AUDITED OFFICIAL DATASETS</span>
          <span className="ctl-badge">200-YEAR SPAN (1826–2026)</span>
          <span className="ctl-badge ctl-badge-green">ZERO UNANCHORED INTERPOLATION</span>
          <span className="ctl-badge">TRUST FIREWALL COMPLIANT</span>
          {loading && <span className="ctl-badge" style={{ opacity: 0.7 }}>SYNCING OBSERVATIONS…</span>}
        </div>

        {/* Indicator Navigation */}
        <div className="ctl-indicator-nav">
          {INDICATORS.map((ind) => (
            <button
              key={ind.id}
              className={`ctl-indicator-btn ${selectedIndicator === ind.id ? 'active' : ''}`}
              onClick={() => setSelectedIndicator(ind.id)}
            >
              {ind.label}
            </button>
          ))}
        </div>
      </div>

      {/* Main Interactive Chart & Controls */}
      <div className="ctl-chart-panel">
        <div className="ctl-chart-controls">
          <div className="ctl-year-focus">
            <span className="ctl-year-number">{selectedYear}</span>
            <span className="ctl-year-label">
              {currentObservation?.is_gap ? (
                <strong style={{ color: '#B45309' }}>HISTORICAL DATA GAP</strong>
              ) : (
                <span>
                  Observed: <strong>{currentObservation?.value} {currentObservation?.unit}</strong>
                  {currentObservation?.uncertainty ? ` (±${currentObservation.uncertainty})` : ''}
                </span>
              )}
            </span>
          </div>

          {/* Quick Year Jump Buttons */}
          <div className="ctl-quick-jumps">
            <button className="ctl-jump-btn" onClick={() => setSelectedYear(1850)}>1850 (Early Ind.)</button>
            <button className="ctl-jump-btn" onClick={() => setSelectedYear(1896)}>1896 (Arrhenius)</button>
            <button className="ctl-jump-btn" onClick={() => setSelectedYear(1958)}>1958 (Keeling MLO)</button>
            <button className="ctl-jump-btn" onClick={() => setSelectedYear(1970)}>1970 (Clean Air)</button>
            <button className="ctl-jump-btn" onClick={() => setSelectedYear(1987)}>1987 (Montreal)</button>
            <button className="ctl-jump-btn" onClick={() => setSelectedYear(2015)}>2015 (Paris Accord)</button>
            <button className="ctl-jump-btn" onClick={() => setSelectedYear(2026)}>2026 (Present)</button>
          </div>
        </div>

        {/* Data Gap Banner when current year has no data */}
        {currentObservation?.is_gap && (
          <div className="ctl-gap-alert">
            <div style={{ fontSize: '18px' }}>⚠</div>
            <div>
              <strong>Historical Coverage Limitation ({selectedYear}):</strong>{' '}
              {currentObservation.gap_reason || 'No verified direct observational measurements exist for this year in the official agency catalog.'}
              <div style={{ marginTop: '4px', fontSize: '12px', opacity: 0.9 }}>
                Climate Chain strictly refuses to invent or fabricate data points across unobserved historical eras.
              </div>
            </div>
          </div>
        )}

        {/* SVG Time Series Visualization */}
        <div className="ctl-svg-wrapper">
          <svg className="ctl-svg-chart" viewBox={`0 0 ${chartWidth} ${chartHeight}`}>
            {/* Grid Lines */}
            <line x1={padding.left} y1={padding.top} x2={padding.left + innerWidth} y2={padding.top} stroke="#E5DAC6" strokeDasharray="3 3" />
            <line x1={padding.left} y1={padding.top + innerHeight / 2} x2={padding.left + innerWidth} y2={padding.top + innerHeight / 2} stroke="#E5DAC6" strokeDasharray="3 3" />
            <line x1={padding.left} y1={padding.top + innerHeight} x2={padding.left + innerWidth} y2={padding.top + innerHeight} stroke="#DDD8CF" strokeWidth="1" />

            {/* Y Axis Labels */}
            <text x={padding.left - 10} y={padding.top + 5} textAnchor="end" fontSize="11" fill="#64615C">
              {maxVal.toFixed(1)}
            </text>
            <text x={padding.left - 10} y={padding.top + innerHeight / 2 + 4} textAnchor="end" fontSize="11" fill="#64615C">
              {((maxVal + minVal) / 2).toFixed(1)}
            </text>
            <text x={padding.left - 10} y={padding.top + innerHeight} textAnchor="end" fontSize="11" fill="#64615C">
              {minVal.toFixed(1)}
            </text>

            {/* Uncertainty Envelope Band */}
            {areaPath && (
              <path d={areaPath} fill="#B45309" fillOpacity="0.12" />
            )}

            {/* Main Observation Trend Curve */}
            {linePath && (
              <path d={linePath} fill="none" stroke="#171717" strokeWidth="2.5" strokeLinecap="round" />
            )}

            {/* Milestone Policy Event Pins */}
            {events.map((evt) => {
              const x = getX(evt.year);
              return (
                <g key={evt.event_id} style={{ cursor: 'pointer' }} onClick={() => setSelectedYear(evt.year)}>
                  <line x1={x} y1={padding.top} x2={x} y2={padding.top + innerHeight} stroke="#DDD8CF" strokeDasharray="2 2" />
                  <circle cx={x} cy={padding.top + 8} r="4" fill="#B84A1D" />
                  <title>{`${evt.year}: ${evt.title}\n${evt.description}`}</title>
                </g>
              );
            })}

            {/* Selected Year Cursor */}
            <line
              x1={getX(selectedYear)}
              y1={padding.top}
              x2={getX(selectedYear)}
              y2={padding.top + innerHeight}
              stroke="#B45309"
              strokeWidth="2"
            />
            {currentObservation && !currentObservation.is_gap && currentObservation.value !== null && (
              <circle
                cx={getX(selectedYear)}
                cy={getY(currentObservation.value)}
                r="6"
                fill="#B45309"
                stroke="#FFFEFA"
                strokeWidth="2"
              />
            )}

            {/* X Axis Year Labels */}
            <text x={getX(1826)} y={padding.top + innerHeight + 20} textAnchor="start" fontSize="11" fill="#64615C">1826</text>
            <text x={getX(1875)} y={padding.top + innerHeight + 20} textAnchor="middle" fontSize="11" fill="#64615C">1875</text>
            <text x={getX(1925)} y={padding.top + innerHeight + 20} textAnchor="middle" fontSize="11" fill="#64615C">1925</text>
            <text x={getX(1975)} y={padding.top + innerHeight + 20} textAnchor="middle" fontSize="11" fill="#64615C">1975</text>
            <text x={getX(2026)} y={padding.top + innerHeight + 20} textAnchor="end" fontSize="11" fill="#64615C">2026</text>
          </svg>
        </div>

        {/* Scrubbing Range Slider */}
        <div className="ctl-slider-row">
          <span style={{ fontSize: '12px', fontWeight: 600, color: '#64615C' }}>1826</span>
          <input
            type="range"
            min="1826"
            max="2026"
            value={selectedYear}
            onChange={(e) => setSelectedYear(parseInt(e.target.value, 10))}
            className="ctl-slider"
          />
          <span style={{ fontSize: '12px', fontWeight: 600, color: '#64615C' }}>2026</span>
        </div>

        {/* Evidence Inspection & Claim Verifier Card */}
        {activeEvidence && (
          <div className="ctl-evidence-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <h3 style={{ margin: 0, fontSize: '16px', color: '#171717', fontFamily: 'var(--serif)' }}>
                Evidence Manifest: {activeEvidence.evidence_id}
              </h3>
              <span className="ctl-badge ctl-badge-green">
                {activeEvidence.payload.verification.firewall_claim_tier}
              </span>
            </div>

            <div className="ctl-evidence-grid">
              <div className="ctl-fact-box">
                <div className="ctl-fact-label">Observed Measurement</div>
                <div className="ctl-fact-val">
                  {activeEvidence.payload.observed_value} {activeEvidence.payload.measurement_unit}
                </div>
              </div>

              <div className="ctl-fact-box">
                <div className="ctl-fact-label">Measurement Uncertainty</div>
                <div className="ctl-fact-val">
                  {activeEvidence.payload.uncertainty ? `±${activeEvidence.payload.uncertainty}` : 'None reported'}
                </div>
              </div>

              <div className="ctl-fact-box">
                <div className="ctl-fact-label">Source Agency</div>
                <div className="ctl-fact-val">
                  {activeEvidence.payload.source_attribution.source_agency}
                </div>
              </div>

              <div className="ctl-fact-box">
                <div className="ctl-fact-label">Cryptographic Digest</div>
                <div className="ctl-fact-val ctl-mono" style={{ fontSize: '11px', wordBreak: 'break-all' }}>
                  {activeEvidence.sha256_digest.slice(0, 18)}...
                </div>
              </div>
            </div>

            <div style={{ fontSize: '12px', color: '#64615C', marginTop: '8px' }}>
              <strong>Citation:</strong> {activeEvidence.payload.source_attribution.citation}
            </div>

            <div className="ctl-actions-row">
              <button className="ctl-btn-primary" onClick={handleDownloadManifest}>
                Download Evidence Manifest (.json)
              </button>
              {onSendToFirewall && (
                <button
                  className="ctl-btn-secondary"
                  onClick={() => onSendToFirewall(activeEvidence)}
                >
                  Verify in Climate Integrity Lab →
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Dataset Registry Toggle & Catalog View */}
      <div className="ctl-catalog-panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h3 style={{ margin: '0 0 4px 0', fontSize: '17px', color: '#171717' }}>
              Official Dataset Registry (IEEE Integrity Catalog)
            </h3>
            <p style={{ margin: 0, fontSize: '13px', color: '#64615C' }}>
              {datasets.length} distinct public scientific datasets with immutable SHA-256 reference digests.
            </p>
          </div>
          <button className="ctl-btn-secondary" onClick={() => setShowCatalog(!showCatalog)}>
            {showCatalog ? 'Hide Catalog' : 'View Full Catalog'}
          </button>
        </div>

        {showCatalog && (
          <div className="ctl-table-wrapper">
            <table className="ctl-table">
              <thead>
                <tr>
                  <th>Dataset ID</th>
                  <th>Title / Agency</th>
                  <th>Coverage & Span</th>
                  <th>License</th>
                  <th>SHA-256 Digest</th>
                </tr>
              </thead>
              <tbody>
                {datasets.map((d) => (
                  <tr key={d.dataset_id}>
                    <td className="ctl-mono"><strong>{d.dataset_id}</strong></td>
                    <td>
                      <div><strong>{d.official_title}</strong></div>
                      <div style={{ fontSize: '11px', color: '#64615C' }}>{d.source_agency}</div>
                    </td>
                    <td>
                      <div>{d.geographic_coverage}</div>
                      <div style={{ fontSize: '11px', color: '#64615C' }}>{d.first_observation_date.slice(0, 4)} to {d.last_observation_date.slice(0, 4)}</div>
                    </td>
                    <td>{d.data_license}</td>
                    <td className="ctl-mono" style={{ fontSize: '10px' }}>
                      <a href={d.source_url} target="_blank" rel="noopener noreferrer" style={{ color: '#171717', textDecoration: 'underline' }}>
                        {d.checksum_sha256.slice(0, 16)}...
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
