import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArcGisMapServerImageryProvider, ArcType, Cartesian2, Cartesian3, Cartographic, Color,
  createWorldTerrainAsync, DistanceDisplayCondition, EllipsoidTerrainProvider, Ion, LabelStyle, Math as CesiumMath,
  JulianDate, PolylineDashMaterialProperty, ScreenSpaceEventHandler, ScreenSpaceEventType, SunLight,
  UrlTemplateImageryProvider, Viewer, WebMercatorTilingScheme,
} from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import './cesium-globe.css';
import type { Place } from '../modules/earth/environment';
import { compassPoint, formatSolarTime, solarPosition } from '../modules/earth/solar';

export interface GlobeMarker extends Place {
  id: string;
  kind: 'facility' | 'production' | 'sample' | 'waste' | 'pilot' | 'air';
  valueLabel?: string;
  /** Overrides the colour for the marker's kind, e.g. an AQI colour. */
  color?: string;
  /** Overrides the point size in pixels. */
  size?: number;
}
export interface GlobeRoute { id: string; from: Place; to: Place; label: string; uncertain?: boolean }
const SATELLITE_URL = 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer';
const LABEL_URL = 'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';
const colors = { facility: '#f1eadb', production: '#fffef9', sample: '#e6dcc7', waste: '#f8f4e9', pilot: '#fdfbf4', air: '#e6dcc7' };
const SIDEREAL_DAY_SECONDS = 86_164.0905;
const ROTATION_SPEEDS = [0, 1, 60, 3600] as const;

export function CesiumGlobe({ place, markers = [], routes = [], radiusKm = 0, onSelectPlace, compact = false, focusHeightM, hideSolar = false }: {
  place: Place | null; markers?: GlobeMarker[]; routes?: GlobeRoute[]; radiusKm?: number;
  onSelectPlace?: (place: Place) => void; compact?: boolean;
  /** Camera height in metres when a place is selected. Defaults to a close-in view (compact: regional view). */
  focusHeightM?: number;
  /** Hides the live solar geometry panel when the globe carries another data layer. */
  hideSolar?: boolean;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const selectionRef = useRef(onSelectPlace);
  const initialPlace = useRef(place);
  const [revision, setRevision] = useState(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [imageryWarning, setImageryWarning] = useState('');
  const [imagery, setImagery] = useState<'satellite' | 'daily'>('satellite');
  const [imageryReady, setImageryReady] = useState(false);
  const [pendingTiles, setPendingTiles] = useState(0);
  const [labels, setLabels] = useState(true);
  const [terrain, setTerrain] = useState(false);
  const [daylight, setDaylight] = useState(true);
  const [rotationSpeed, setRotationSpeed] = useState<number>(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1);
  const rotationSpeedRef = useRef(rotationSpeed);
  const [simulationDate, setSimulationDate] = useState(() => new Date());
  const [pickedPlace, setPickedPlace] = useState<Place | null>(null);
  const [date, setDate] = useState(() => new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10));
  const ionToken = import.meta.env.VITE_CESIUM_ION_TOKEN as string | undefined;
  const [cameraMode, setCameraMode] = useState<'orbit' | 'overhead'>('orbit');

  useEffect(() => { selectionRef.current = onSelectPlace; }, [onSelectPlace]);
  useEffect(() => { rotationSpeedRef.current = rotationSpeed; }, [rotationSpeed]);
  useEffect(() => { setPickedPlace(null); }, [place?.lat, place?.lng, place?.name]);
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let viewer: Viewer;
    setReady(false); setError('');
    try {
      // No default ion token or hidden external geocoder. Explicit imagery is added below.
      viewer = new Viewer(mount, {
        baseLayer: false, baseLayerPicker: false, geocoder: false, animation: false, timeline: false,
        homeButton: false, sceneModePicker: false, navigationHelpButton: false, fullscreenButton: false,
        infoBox: false, selectionIndicator: false, requestRenderMode: true,
        maximumRenderTimeChange: Math.max(1, rotationSpeedRef.current / 30), shouldAnimate: true,
        terrainProvider: new EllipsoidTerrainProvider(),
        contextOptions: { webgl: { alpha: false, antialias: true } },
      });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'WebGL could not initialize.'); return; }
    viewerRef.current = viewer;
    viewer.resolutionScale = Math.min(1.5, window.devicePixelRatio || 1);
    viewer.scene.globe.baseColor = Color.fromCssColorString('#f1eadb');
    viewer.scene.backgroundColor = Color.fromCssColorString('#f6f2e9');
    if (viewer.scene.skyBox) viewer.scene.skyBox.show = false;
    if (viewer.scene.sun) viewer.scene.sun.show = true;
    if (viewer.scene.moon) viewer.scene.moon.show = false;
    viewer.scene.light = new SunLight();
    viewer.scene.globe.enableLighting = true;
    viewer.scene.globe.dynamicAtmosphereLighting = true;
    viewer.scene.globe.dynamicAtmosphereLightingFromSun = true;
    // Preserve the day/night terminator at both local and whole-Earth camera heights.
    viewer.scene.globe.lightingFadeOutDistance = 0;
    viewer.scene.globe.lightingFadeInDistance = 1;
    viewer.clock.currentTime = JulianDate.now();
    viewer.clock.multiplier = rotationSpeedRef.current;
    viewer.clock.shouldAnimate = rotationSpeedRef.current > 0;
    viewer.scene.screenSpaceCameraController.minimumZoomDistance = 200;
    viewer.scene.screenSpaceCameraController.maximumZoomDistance = 40_000_000;
    const focus = initialPlace.current ?? { lat: 22, lng: 77, name: 'Earth' };
    viewer.camera.setView({ destination: Cartesian3.fromDegrees(focus.lng, focus.lat, compact ? 15_000_000 : 9_000_000) });
    viewer.canvas.setAttribute('aria-label', 'Live solar Earth globe. Drag to pan, wheel or pinch to zoom, right drag to tilt. Click a point to inspect solar geometry and climate data.');
    viewer.canvas.tabIndex = 0;
    const handler = new ScreenSpaceEventHandler(viewer.canvas);
    const inspectPlace = (next: Place) => {
      setPickedPlace(next);
      if (selectionRef.current) return;
      viewer.camera.flyTo({
        destination: Cartesian3.fromDegrees(next.lng, next.lat, compact ? 2_500_000 : 160_000),
        orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
        duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 0.8,
      });
    };
    handler.setInputAction((event: { position: Cartesian2 }) => {
      const picked = viewer.scene.pick(event.position);
      const entity = picked?.id;
      const entityPlace = entity?.properties?.place?.getValue(viewer.clock.currentTime) as Place | undefined;
      if (entityPlace) { inspectPlace(entityPlace); selectionRef.current?.(entityPlace); return; }
      const ray = viewer.camera.getPickRay(event.position);
      const point = ray && viewer.scene.globe.pick(ray, viewer.scene);
      if (!point) return;
      const geo = Cartographic.fromCartesian(point);
      const lat = CesiumMath.toDegrees(geo.latitude); const lng = CesiumMath.toDegrees(geo.longitude);
      inspectPlace({ lat, lng, name: `${lat.toFixed(5)}, ${lng.toFixed(5)}` });
      selectionRef.current?.({ lat, lng, name: `${lat.toFixed(4)}°, ${lng.toFixed(4)}°` });
    }, ScreenSpaceEventType.LEFT_CLICK);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === '+' || event.key === '=') viewer.camera.zoomIn(viewer.camera.positionCartographic.height * 0.3);
      else if (event.key === '-') viewer.camera.zoomOut(viewer.camera.positionCartographic.height * 0.4);
      else if (event.key === 'ArrowLeft') viewer.camera.rotateLeft(0.05);
      else if (event.key === 'ArrowRight') viewer.camera.rotateRight(0.05);
      else if (event.key === 'ArrowUp') viewer.camera.rotateUp(0.05);
      else if (event.key === 'ArrowDown') viewer.camera.rotateDown(0.05);
      else return;
      event.preventDefault(); viewer.scene.requestRender();
    };
    viewer.canvas.addEventListener('keydown', onKey);
    const resize = new ResizeObserver(() => { if (!viewer.isDestroyed()) { viewer.resize(); viewer.scene.requestRender(); } });
    resize.observe(mount);
    const removeRenderError = viewer.scene.renderError.addEventListener((_scene, cause) => { setError(`The globe renderer stopped: ${cause.message}`); });
    const removeTileProgress = viewer.scene.globe.tileLoadProgressEvent.addEventListener((count: number) => setPendingTiles(count));
    let previousSpinTime: JulianDate | undefined;
    const removeSiderealRotation = viewer.scene.preUpdate.addEventListener((_scene, time: JulianDate) => {
      if (rotationSpeedRef.current <= 0) { previousSpinTime = JulianDate.clone(time, previousSpinTime); return; }
      if (!previousSpinTime) { previousSpinTime = JulianDate.clone(time); return; }
      const elapsed = JulianDate.secondsDifference(time, previousSpinTime);
      const renderStep = Math.max(1, rotationSpeedRef.current / 30);
      if (elapsed < renderStep) return;
      previousSpinTime = JulianDate.clone(time, previousSpinTime);
      // In the Earth-fixed frame, an inertial camera moves west at the sidereal rate.
      viewer.camera.rotate(Cartesian3.UNIT_Z, Math.PI * 2 * elapsed / SIDEREAL_DAY_SECONDS);
    });
    const syncSimulationDate = () => {
      if (!viewer.isDestroyed()) setSimulationDate(JulianDate.toDate(viewer.clock.currentTime));
    };
    syncSimulationDate();
    const simulationTimer = window.setInterval(syncSimulationDate, 1000);
    setReady(true);
    return () => {
      resize.disconnect(); removeRenderError(); removeTileProgress(); removeSiderealRotation(); window.clearInterval(simulationTimer); handler.destroy(); viewer.canvas.removeEventListener('keydown', onKey);
      if (!viewer.isDestroyed()) viewer.destroy();
      viewerRef.current = null;
    };
  }, [revision, compact]);

  useEffect(() => {
    const mountedViewer = viewerRef.current;
    if (!ready || !mountedViewer) return;
    const viewer = mountedViewer;
    let active = true;
    const cleanups: (() => void)[] = [];
    setImageryReady(false); setImageryWarning('');
    async function load() {
      try {
        const provider = imagery === 'satellite'
          ? await ArcGisMapServerImageryProvider.fromUrl(SATELLITE_URL, { enablePickFeatures: false })
          : new UrlTemplateImageryProvider({
            url: `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/${date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`,
            tilingScheme: new WebMercatorTilingScheme(), maximumLevel: 9,
            credit: 'NASA EOSDIS GIBS · VIIRS S-NPP true-color daily composite',
          });
        if (!active || viewer.isDestroyed()) return;
        viewer.imageryLayers.removeAll();
        viewer.imageryLayers.addImageryProvider(provider);
        cleanups.push(provider.errorEvent.addEventListener(() => { if (active) setImageryWarning('Some imagery tiles are unavailable. Try another date, zoom out, or switch imagery.'); }));
        if (labels) {
          const reference = new UrlTemplateImageryProvider({ url: LABEL_URL, maximumLevel: 18, credit: 'Esri reference labels' });
          viewer.imageryLayers.addImageryProvider(reference);
        }
        setImageryReady(true); viewer.scene.requestRender();
      } catch (cause) { if (active) setImageryWarning(cause instanceof Error ? cause.message : 'Satellite imagery could not load.'); }
    }
    void load();
    return () => { active = false; cleanups.forEach((cleanup) => cleanup()); };
  }, [ready, imagery, date, labels, revision]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!ready || !viewer) return;
    let active = true;
    if (terrain && ionToken) {
      Ion.defaultAccessToken = ionToken;
      void createWorldTerrainAsync().then((provider) => { if (active && !viewer.isDestroyed()) { viewer.terrainProvider = provider; viewer.scene.requestRender(); } }).catch(() => { if (active) { setTerrain(false); setImageryWarning('Terrain service is unavailable. Satellite imagery remains available.'); } });
    } else viewer.terrainProvider = new EllipsoidTerrainProvider();
    return () => { active = false; };
  }, [terrain, ionToken, ready, revision]);
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!ready || !viewer) return;
    viewer.scene.globe.enableLighting = daylight;
    if (viewer.scene.sun) viewer.scene.sun.show = daylight;
    viewer.scene.requestRender();
  }, [daylight, ready]);
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!ready || !viewer) return;
    viewer.clock.multiplier = rotationSpeed;
    viewer.clock.shouldAnimate = rotationSpeed > 0;
    viewer.scene.maximumRenderTimeChange = Math.max(1, rotationSpeed / 30);
    viewer.scene.requestRender();
  }, [rotationSpeed, ready]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!ready || !viewer) return;
    viewer.entities.removeAll();
    const addMarker = (marker: Place, id: string, color: string, text: string, selected = false, size = 9) => {
      viewer.entities.add({ id, position: Cartesian3.fromDegrees(marker.lng, marker.lat, 50),
        point: { color: Color.fromCssColorString(color), pixelSize: selected ? 15 : size, outlineColor: Color.fromCssColorString('#464137'), outlineWidth: 2 },
        label: { text, font: selected ? 'bold 13px sans-serif' : '12px sans-serif', fillColor: Color.fromCssColorString('#2e2b25'), style: LabelStyle.FILL_AND_OUTLINE, outlineColor: Color.fromCssColorString('#fffef9'), outlineWidth: 2, showBackground: true, backgroundColor: Color.fromCssColorString('#fdfbf4f0'), pixelOffset: new Cartesian2(0, -24), distanceDisplayCondition: new DistanceDisplayCondition(0, selected ? Number.POSITIVE_INFINITY : 2_000_000) },
        properties: { place: marker },
      });
    };
    markers.slice(0, 500).forEach((marker) => addMarker(marker, `point:${marker.id}`, marker.color ?? colors[marker.kind], marker.valueLabel ? `${marker.name} · ${marker.valueLabel}` : marker.name, false, marker.size));
    if (place) {
      addMarker(place, 'selected-place', '#fffef9', place.name, true);
      if (radiusKm > 0) viewer.entities.add({ id: 'inspection-radius', position: Cartesian3.fromDegrees(place.lng, place.lat), ellipse: { semiMajorAxis: radiusKm * 1000, semiMinorAxis: radiusKm * 1000, material: Color.fromCssColorString('#fffef9').withAlpha(0.13), outline: true, outlineColor: Color.fromCssColorString('#f1eadb'), height: 0 } });
    }
    routes.slice(0, 100).forEach((route) => viewer.entities.add({ id: `route:${route.id}`, polyline: { positions: Cartesian3.fromDegreesArrayHeights([route.from.lng, route.from.lat, 300, route.to.lng, route.to.lat, 300]), width: 3, arcType: ArcType.GEODESIC, material: route.uncertain ? new PolylineDashMaterialProperty({ color: Color.fromCssColorString('#f1eadb') }) : Color.fromCssColorString('#fffef9') }, properties: { label: route.label } }));
    viewer.scene.requestRender();
  }, [ready, markers, routes, place, radiusKm, revision]);

  const lat = place?.lat; const lng = place?.lng;
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!ready || !viewer || lat === undefined || lng === undefined) return;
    // Selection updates never recreate the viewer or reset its imagery.
    viewer.camera.flyTo({ destination: Cartesian3.fromDegrees(lng, lat, focusHeightM ?? (compact ? 6_000_000 : 160_000)), orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 }, duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1.1 });
  }, [lat, lng, ready, compact, focusHeightM, revision]);

  const camera = (action: 'home' | 'in' | 'out' | 'tilt' | 'expand') => {
    const viewer = viewerRef.current; if (!viewer || viewer.isDestroyed()) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (action === 'in') viewer.camera.zoomIn(viewer.camera.positionCartographic.height * 0.45);
    if (action === 'out') viewer.camera.zoomOut(viewer.camera.positionCartographic.height * 0.6);
    if (action === 'home') viewer.camera.flyTo({ destination: Cartesian3.fromDegrees(place?.lng ?? 0, place?.lat ?? 15, 20_000_000), duration: reduceMotion ? 0 : 1 });
    if (action === 'tilt') {
      const next = cameraMode === 'overhead' ? 'orbit' : 'overhead'; setCameraMode(next);
      viewer.camera.flyTo({ destination: Cartesian3.fromDegrees(place?.lng ?? 77, (place?.lat ?? 28) - (next === 'orbit' ? 0.3 : 0), 70_000), orientation: { heading: 0, pitch: next === 'orbit' ? -Math.PI / 4 : -Math.PI / 2, roll: 0 }, duration: reduceMotion ? 0 : 0.6 });
    }
    if (action === 'expand') {
      void (document.fullscreenElement ? document.exitFullscreen() : mountRef.current?.parentElement?.requestFullscreen())?.catch(() => setImageryWarning('Fullscreen is unavailable in this browser. The globe remains interactive in the workspace.'));
    }
    viewer.scene.requestRender();
  };

  const solarPlace = pickedPlace ?? place;
  const solar = useMemo(() => solarPosition(simulationDate, solarPlace?.lat ?? 0, solarPlace?.lng ?? 0), [simulationDate, solarPlace?.lat, solarPlace?.lng]);
  const solarState = solar.elevationDeg >= 0 ? 'Daylight at selected point' : solar.elevationDeg >= -6 ? 'Civil twilight at selected point' : 'Night at selected point';
  return <div className={`cesium-earth ${compact ? 'cesium-earth-compact' : ''}`} data-pending-tiles={pendingTiles}>
    <div className="cesium-earth-canvas" ref={mountRef} />
    <div className="earth-map-controls" aria-label="Globe controls">
      <label>Imagery <select value={imagery} onChange={(event) => setImagery(event.target.value as 'satellite' | 'daily')}><option value="satellite">Satellite / Esri</option><option value="daily">Daily satellite / NASA</option></select></label>
      {imagery === 'daily' && <label>Image date <input type="date" value={date} max={new Date().toISOString().slice(0, 10)} onChange={(event) => { if (event.target.value) setDate(event.target.value); }} /></label>}
      <label><input type="checkbox" checked={labels} onChange={(event) => setLabels(event.target.checked)} />Labels</label>
      <label><input type="checkbox" checked={daylight} onChange={(event) => setDaylight(event.target.checked)} />Sunlight</label>{!compact && ionToken && <label><input type="checkbox" checked={terrain} onChange={(event) => setTerrain(event.target.checked)} />3D terrain</label>}
    </div>
    <div className="earth-camera-controls" aria-label="Camera controls"><button type="button" onClick={() => camera('home')} disabled={!ready} aria-label="View whole Earth">Home</button><button type="button" onClick={() => camera('in')} disabled={!ready} aria-label="Zoom in">+</button><button type="button" onClick={() => camera('out')} disabled={!ready} aria-label="Zoom out">-</button><button type="button" onClick={() => camera('tilt')} disabled={!ready}>{cameraMode === 'orbit' ? 'Overhead' : 'Tilt 3D'}</button>{!compact && <button type="button" onClick={() => camera('expand')} disabled={!ready} aria-label="Expand satellite globe">Full</button>}</div>
    <div className="earth-imagery-note" role="status">{error ? 'Globe unavailable' : !ready ? 'Starting CesiumJS...' : !imageryReady ? 'Connecting satellite imagery...' : imagery === 'daily' ? `NASA VIIRS / ${date} / daily composite` : 'Esri World Imagery / satellite and aerial mosaic'}<span>{pendingTiles > 0 ? `Loading ${pendingTiles} map tiles / ` : ''}{terrain ? 'World terrain' : 'WGS84 ellipsoid'} / imagery capture dates vary / {onSelectPlace ? 'click a point to inspect sunlight and climate' : 'click a point to inspect sunlight'}</span></div>
    {!hideSolar && <aside className={`earth-solar-panel ${compact ? 'earth-solar-panel-compact' : ''}`} aria-label="Live solar position">
      <div className="earth-solar-heading"><span>LIVE SOLAR GEOMETRY</span></div>
      <label className="earth-speed-control">Earth spin <select value={rotationSpeed} onChange={(event) => setRotationSpeed(Number(event.target.value))} aria-label="Earth rotation speed">
        {ROTATION_SPEEDS.map((speed) => <option key={speed} value={speed}>{speed === 0 ? 'Paused' : speed === 1 ? 'Real time / 1x' : speed === 60 ? '1 min per sec / 60x' : '1 hour per sec / 3600x'}</option>)}
      </select></label>
      <strong>{solarState}</strong>
      <dl>
        <div><dt>Sun from</dt><dd>{compassPoint(solar.azimuthDeg)} | {solar.azimuthDeg.toFixed(1)} deg</dd></div>
        <div><dt>Sun altitude</dt><dd>{solar.elevationDeg.toFixed(1)} deg</dd></div>
        <div><dt>Subsolar point</dt><dd>{solar.subsolarLatitudeDeg.toFixed(2)}, {solar.subsolarLongitudeDeg.toFixed(2)} deg</dd></div>
        <>
        <div><dt>North Pole</dt><dd>{solar.declinationDeg > 0 ? 'Sun above horizon' : solar.declinationDeg < 0 ? 'Sun below horizon' : 'Equinox'} | {solar.declinationDeg.toFixed(2)} deg</dd></div>
        {!compact && <div><dt>Apparent solar time</dt><dd>{formatSolarTime(solar.apparentSolarMinutes)}</dd></div>}
        </>
      </dl>
      <small>{solarPlace?.name ?? 'Equator'} | {simulationDate.toISOString().replace('T', ' ').slice(0, 19)} UTC | 23.44 deg axial tilt model</small>
    </aside>}
    {(error || imageryWarning) && <div className="earth-map-error" role="alert">{error || imageryWarning}<button type="button" onClick={() => { setRevision((value) => value + 1); setImagery('satellite'); }}>Retry satellite view</button></div>}
  </div>;
}
