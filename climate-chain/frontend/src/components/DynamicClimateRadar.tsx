import { useState, useEffect, useRef } from 'react';
import type { Overview } from '../types';
import type { CityKey } from '../api';

interface Hotspot {
  id: string;
  name: string;
  cityKey?: CityKey;
  lat: number;
  lng: number;
  category: 'waste' | 'fire' | 'water' | 'air';
  title: string;
  metric: string;
  status: 'ILLUSTRATIVE EXAMPLE';
  description: string;
}

const HOTSPOTS: Hotspot[] = [
  {
    id: 'delhi',
    name: 'Delhi & NCR',
    cityKey: 'delhi',
    lat: 28.6139,
    lng: 77.2090,
    category: 'air',
    title: 'Air Exposure & Ambient PM2.5',
    metric: '107 µg/m³ PM2.5',
    status: 'ILLUSTRATIVE EXAMPLE',
    description: 'Example scenario near the Anand Vihar corridor.'
  },
  {
    id: 'punjab',
    name: 'Punjab Farmland',
    lat: 31.1471,
    lng: 75.3412,
    category: 'fire',
    title: 'Stubble Burn Prevention',
    metric: '10 Fields · 55 Acres Cleared',
    status: 'ILLUSTRATIVE EXAMPLE',
    description: 'Baler teams dispatched to harvest paddy straw before burning season.'
  },
  {
    id: 'jodhpur',
    name: 'Jodhpur Pilot',
    lat: 26.2389,
    lng: 73.0243,
    category: 'waste',
    title: 'Community Waste Sites',
    metric: '4 Open Dumps · 1 Verified',
    status: 'ILLUSTRATIVE EXAMPLE',
    description: 'Privacy-preserving community photos submitted via DumpWatch.'
  },
  {
    id: 'mumbai',
    name: 'Mumbai Ward 12',
    lat: 19.0760,
    lng: 72.8777,
    category: 'water',
    title: 'Drinking Water Tripwire',
    metric: '23 Homes Warned',
    status: 'ILLUSTRATIVE EXAMPLE',
    description: 'TapAlert telegram bot joined by 23 resident households.'
  },
  {
    id: 'niger',
    name: 'Niger Delta',
    lat: 4.8156,
    lng: 7.0498,
    category: 'fire',
    title: 'Gas Flare Satellite Anchor',
    metric: 'Methane Watch Active',
    status: 'ILLUSTRATIVE EXAMPLE',
    description: 'Example scenario: nightly satellite flare detections would be checked against recorded file digests.'
  }
];

export function DynamicClimateRadar({
  data: _data,
  selectedCity,
  onSelectCity,
  onNavigate
}: {
  data?: Overview;
  selectedCity: CityKey;
  onSelectCity?: (city: CityKey) => void;
  onNavigate?: (view: string) => void;
}) {
  const [activeSpot, setActiveSpot] = useState<Hotspot>(HOTSPOTS[0]);
  const [pulseTick, setPulseTick] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Sync active spot with city selection
  useEffect(() => {
    const match = HOTSPOTS.find(h => h.cityKey === selectedCity);
    if (match) setActiveSpot(match);
  }, [selectedCity]);

  // Periodic pulse
  useEffect(() => {
    const interval = setInterval(() => {
      setPulseTick(t => (t + 1) % 100);
    }, 50);
    return () => clearInterval(interval);
  }, []);

  // Canvas drawing for interactive radar / globe
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(centerX, centerY) - 24;

    ctx.clearRect(0, 0, width, height);

    // Outer glow
    const grad = ctx.createRadialGradient(centerX, centerY, radius * 0.4, centerX, centerY, radius);
    grad.addColorStop(0, 'rgba(14, 107, 85, 0.07)');
    grad.addColorStop(0.7, 'rgba(14, 107, 85, 0.03)');
    grad.addColorStop(1, 'rgba(14, 107, 85, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.fill();

    // Concentric orbital rings
    ctx.strokeStyle = 'rgba(120, 130, 138, 0.30)';
    ctx.lineWidth = 1;
    [0.35, 0.65, 0.95].forEach(scale => {
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius * scale, 0, Math.PI * 2);
      ctx.stroke();
    });

    // Crosshairs
    ctx.strokeStyle = 'rgba(120, 130, 138, 0.22)';
    ctx.beginPath();
    ctx.moveTo(centerX - radius, centerY);
    ctx.lineTo(centerX + radius, centerY);
    ctx.moveTo(centerX, centerY - radius);
    ctx.lineTo(centerX, centerY + radius);
    ctx.stroke();

    // Rotating radar sweep
    const angle = (pulseTick * 3.6 * Math.PI) / 180;
    const sweepGrad = ctx.createConicGradient(angle, centerX, centerY);
    sweepGrad.addColorStop(0, 'rgba(14, 107, 85, 0.30)');
    sweepGrad.addColorStop(0.12, 'rgba(14, 107, 85, 0.08)');
    sweepGrad.addColorStop(0.25, 'rgba(14, 107, 85, 0)');
    sweepGrad.addColorStop(1, 'rgba(14, 107, 85, 0)');

    ctx.save();
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius * 0.95, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = sweepGrad;
    ctx.fill();
    ctx.restore();

    // Subtle latitude and longitude curves
    ctx.strokeStyle = 'rgba(120, 130, 138, 0.18)';
    ctx.lineWidth = 1;
    [-0.5, 0, 0.5].forEach(latOffset => {
      ctx.beginPath();
      ctx.ellipse(centerX, centerY + latOffset * (radius * 0.5), radius * 0.85, radius * 0.28, 0, 0, Math.PI * 2);
      ctx.stroke();
    });

  }, [pulseTick]);

  const categoryColor = {
    waste: '#B4730E',
    fire: '#D1431F',
    water: '#1F6FB2',
    air: '#6A58CF'
  }[activeSpot.category];

  return (
    <div className="dynamic-radar-container">
      <div className="radar-visual-pane">
        <canvas
          ref={canvasRef}
          width={500}
          height={380}
          className="radar-canvas"
        />

        {/* Hotspot markers on the radar */}
        <div className="radar-markers-overlay">
          {HOTSPOTS.map((spot, idx) => {
            // Calculate a nice circular distribution around the center
            const radAngle = (idx / HOTSPOTS.length) * Math.PI * 2 - Math.PI / 4;
            const dist = 32 + (idx % 2 === 0 ? 8 : -4); // percentage from center
            const x = 50 + Math.cos(radAngle) * dist;
            const y = 50 + Math.sin(radAngle) * dist;
            const isSelected = spot.id === activeSpot.id;

            return (
              <button
                key={spot.id}
                type="button"
                className={`radar-pin-btn ${isSelected ? 'selected' : ''} pin-${spot.category}`}
                style={{ left: `${x}%`, top: `${y}%` }}
                onClick={() => {
                  setActiveSpot(spot);
                  if (spot.cityKey && onSelectCity) {
                    onSelectCity(spot.cityKey);
                  }
                }}
                aria-label={`View ${spot.name}: ${spot.title}`}
              >
                <span className="radar-pin-core" />
                <span className="radar-pin-ripple" />
                <span className="radar-pin-label">{spot.name}</span>
              </button>
            );
          })}
        </div>

        <div className="radar-status-badge">
          <span className="pulse-dot-green" />
          <span>ILLUSTRATIVE EXAMPLE · NOT LIVE SENSOR DATA</span>
        </div>
      </div>

      {/* Interactive Detail Card */}
      <div className="radar-details-card">
        <div className="radar-card-header">
          <div className="radar-category-pill" style={{ backgroundColor: `${categoryColor}15`, color: categoryColor, borderColor: `${categoryColor}40` }}>
            {activeSpot.category.toUpperCase()} SIGNAL
          </div>
          <span className="radar-live-indicator">
            <span className="live-dot" style={{ backgroundColor: categoryColor }} />
            {activeSpot.status}
          </span>
        </div>

        <h3 className="radar-spot-title">{activeSpot.name}</h3>
        <div className="radar-spot-subtitle">{activeSpot.title}</div>

        <div className="radar-metric-callout" style={{ borderLeftColor: categoryColor }}>
          <div className="radar-metric-val">{activeSpot.metric}</div>
          <div className="radar-metric-desc">{activeSpot.description}</div>
        </div>

        {/* Quick actions for this spot */}
        <div className="radar-spot-actions">
          <button
            type="button"
            className="radar-primary-btn"
            style={{ backgroundColor: categoryColor }}
            onClick={() => {
              if (onNavigate) {
                onNavigate(activeSpot.category);
              }
            }}
          >
            Explore {activeSpot.name}
          </button>
          
          <button
            type="button"
            className="radar-secondary-btn"
            onClick={() => {
              if (onNavigate) {
                onNavigate('earth');
              }
            }}
          >
            Satellite view
          </button>
        </div>

        {/* Hotspot quick selectors */}
        <div className="radar-spot-chips">
          <span className="chips-label">Quick Jump:</span>
          {HOTSPOTS.map(h => (
            <button
              key={h.id}
              type="button"
              className={`spot-chip ${h.id === activeSpot.id ? 'active' : ''}`}
              onClick={() => {
                setActiveSpot(h);
                if (h.cityKey && onSelectCity) onSelectCity(h.cityKey);
              }}
            >
              {h.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
