import { useMemo, useState } from 'react';
import type { Overview } from '../types';
import { CesiumGlobe, type GlobeMarker } from './CesiumGlobe';
import { DynamicClimateRadar } from './DynamicClimateRadar';
import type { CityKey } from '../api';

export function Globe3D({
  data,
  showWasteSites = true,
  reviewSite = null,
  onNavigate,
  onSelectCity
}: {
  data: Overview;
  showPilotBeacons?: boolean;
  showSchematicLinks?: boolean;
  showWasteSites?: boolean;
  reviewSite?: { lat: number; lng: number } | null;
  onNavigate?: (view: string) => void;
  onSelectCity?: (city: CityKey) => void;
}) {
  const [viewMode, setViewMode] = useState<'radar' | 'satellite'>('radar');

  const place = useMemo(
    () =>
      reviewSite
        ? { ...reviewSite, name: 'Selected evidence site' }
        : {
            lat: data.air.place?.lat ?? data.city.lat,
            lng: data.air.place?.lng ?? data.city.lng,
            name: data.city.name
          },
    [reviewSite, data.air.place?.lat, data.air.place?.lng, data.city]
  );

  const markers = useMemo<GlobeMarker[]>(
    () =>
      (showWasteSites ? data.waste.sites : []).flatMap((site) =>
        site.lat == null || site.lng == null
          ? []
          : [
              {
                id: site.id,
                name: `JunkSnap ${site.id}`,
                lat: site.lat,
                lng: site.lng,
                kind: 'waste' as const,
                valueLabel: data.sources.junksnap.mode === 'live' ? 'Source report' : 'SIMULATED'
              }
            ]
      ),
    [showWasteSites, data.waste.sites, data.sources.junksnap.mode]
  );

  return (
    <div className="climate-globe-frame">
      <div className="globe-mode-switch">
        <button
          type="button"
          className={`mode-toggle-btn ${viewMode === 'radar' ? 'active' : ''}`}
          onClick={() => setViewMode('radar')}
        >
          <span className="mode-icon">📡</span> Dynamic Signal Radar
        </button>
        <button
          type="button"
          className={`mode-toggle-btn ${viewMode === 'satellite' ? 'active' : ''}`}
          onClick={() => setViewMode('satellite')}
        >
          <span className="mode-icon">🛰️</span> Cesium 3D Satellite
        </button>
      </div>

      {viewMode === 'radar' ? (
        <DynamicClimateRadar
          data={data}
          selectedCity={data.city.name.toLowerCase() === 'jodhpur' ? 'jodhpur' : data.city.name.toLowerCase() === 'chandigarh' ? 'chandigarh' : 'delhi'}
          onSelectCity={onSelectCity}
          onNavigate={onNavigate}
        />
      ) : (
        <div className="globe-wrap">
          <CesiumGlobe compact place={place} markers={markers} />
        </div>
      )}
    </div>
  );
}
