import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { fetchAgentMemory, fetchOverview, fetchProjectApps, fetchServices, type AgentMemorySnapshot, type CityKey, type ProjectAppStatus } from './api';
import type { Overview, SourceStatus } from './types';
import { Overview as OverviewView } from './modules/Overview';
import { Waste } from './modules/Waste';
import { Fire } from './modules/Fire';
import { Water } from './modules/Water';
import { Air } from './modules/Air';
import { CAPABILITIES, PROJECT_FOLDER_COUNT, type FocusId, type StageId, type WorkspaceView } from './data/capabilities';
import { AgentMemory } from './modules/AgentMemory';
import { CommandPalette } from './components/CommandPalette';
import { WorkspaceErrorBoundary } from './components/WorkspaceErrorBoundary';

const MissionPath = lazy(() => import('./modules/Workspace').then((module) => ({ default: module.MissionPath })));
const CapabilityLibrary = lazy(() => import('./modules/Workspace').then((module) => ({ default: module.CapabilityLibrary })));
const MissionStudio = lazy(() => import('./modules/MissionStudio').then((module) => ({ default: module.MissionStudio })));
const CascadeReview = lazy(() => import('./modules/CascadeReview').then((module) => ({ default: module.CascadeReview })));

const NAV: { id: WorkspaceView; label: string; title: string; section: 'workspace' | 'signals' }[] = [
  { id: 'overview', label: 'Command center', title: 'Climate Chain', section: 'workspace' },
  { id: 'memory', label: 'AI engineering memory', title: 'Engineering memory', section: 'workspace' },
  { id: 'studio', label: 'Unified mission studio', title: 'Unified mission studio', section: 'workspace' },
  { id: 'mission', label: 'Guided mission path', title: 'From signal to proof', section: 'workspace' },
  { id: 'cascade', label: 'Place-based review', title: 'Climate Cascade Review', section: 'workspace' },
  { id: 'capabilities', label: 'All capabilities', title: 'Connected climate tools', section: 'workspace' },
  { id: 'waste', label: 'Waste · JunkSnap', title: 'Waste · JunkSnap', section: 'signals' },
  { id: 'fire', label: 'Fire · clearsky', title: 'Fire · clearsky', section: 'signals' },
  { id: 'water', label: 'Water · Teesri Shikayat', title: 'Water · Teesri Shikayat', section: 'signals' },
  { id: 'air', label: 'Air · Vayu', title: 'Air · The Vayu Project', section: 'signals' },
];

export default function App() {
  const [view, setView] = useState<WorkspaceView>('overview');
  const [activeStage, setActiveStage] = useState<StageId>('sense');
  const [focus, setFocus] = useState<FocusId>('farmland');
  const [studioSelection, setStudioSelection] = useState<string[]>(() => CAPABILITIES.map((item) => item.id));
  const [studioTitle, setStudioTitle] = useState('Climate action mission');
  const [studioPlace, setStudioPlace] = useState('');
  const [city, setCity] = useState<CityKey>('delhi');
  const [cascadeSiteId, setCascadeSiteId] = useState<string | null>(null);
  const [data, setData] = useState<Overview | null>(null);
  const [services, setServices] = useState<SourceStatus[]>([]);
  const [servicesError, setServicesError] = useState<string | null>(null);
  const [projectApps, setProjectApps] = useState<Record<string, ProjectAppStatus>>({});
  const [error, setError] = useState<string | null>(null);
  const [memorySnapshot, setMemorySnapshot] = useState<AgentMemorySnapshot | null>(null);
  const [memoryChecking, setMemoryChecking] = useState(true);
  const [memoryError, setMemoryError] = useState<string | null>(null);
  const [commandOpen, setCommandOpen] = useState(false);
  const [focusMemoryId, setFocusMemoryId] = useState<string | null>(null);
  const [focusMissionId, setFocusMissionId] = useState<string | null>(null);

  const updateMemoryGate = useCallback((snapshot: AgentMemorySnapshot | null) => {
    setMemorySnapshot(snapshot);
    setMemoryChecking(false);
    setMemoryError(snapshot ? null : 'Local memory is unavailable. Agent work must stop until recall is restored.');
  }, []);

  const refreshMemoryGate = useCallback(async (signal?: AbortSignal) => {
    setMemoryChecking(true);
    try {
      const snapshot = await fetchAgentMemory(signal);
      updateMemoryGate(snapshot);
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      setMemorySnapshot(null);
      setMemoryChecking(false);
      setMemoryError(e instanceof Error ? e.message : 'Local memory recall failed.');
    }
  }, [updateMemoryGate]);

  useEffect(() => {
    const ctrl = new AbortController();
    void refreshMemoryGate(ctrl.signal);
    return () => ctrl.abort();
  }, [refreshMemoryGate]);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchOverview(city, ctrl.signal)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => {
        if (e.name !== 'AbortError') setError(e.message);
      });
    fetchServices(ctrl.signal)
      .then((s) => { setServices(s.services); setServicesError(null); })
      .catch((e) => {
        if (e.name !== 'AbortError') {
          setServices([]);
          setServicesError(e instanceof Error ? e.message : 'Source status could not be loaded.');
        }
      });
    return () => ctrl.abort();
  }, [city]);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchProjectApps(ctrl.signal)
      .then((result) => setProjectApps(Object.fromEntries(result.apps.map((app) => [app.id, app]))))
      .catch(() => setProjectApps({}));
    return () => ctrl.abort();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const nav = NAV.find((n) => n.id === view)!;
  const navigate = (destination: WorkspaceView, memoryId?: string, missionId?: string) => {
    setFocusMemoryId(memoryId ?? null);
    setFocusMissionId(missionId ?? null);
    setView(destination);
  };
  const openMemory = () => {
    navigate('memory');
    void refreshMemoryGate();
  };

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">CC</div>
          <div>
            <div className="brand-name">Climate Chain</div>
            <div className="brand-sub">One path · {PROJECT_FOLDER_COUNT} projects</div>
          </div>
        </div>
        <nav className="primary-nav" aria-label="Main navigation">
          <div className="nav-section-label">WORKSPACE</div>
          {NAV.filter((n) => n.section === 'workspace').map((n) => (
            <button
              key={n.id}
              className={'nav-item' + (n.id === 'memory' ? ' nav-memory' : '') + (view === n.id ? ' active' : '')}
              onClick={() => navigate(n.id)}
              aria-current={view === n.id ? 'page' : undefined}
            >
              {n.label}
            </button>
          ))}
          <div className="nav-section-label nav-section-spaced">CONNECTED SIGNALS</div>
          {NAV.filter((n) => n.section === 'signals').map((n) => (
            <button
              key={n.id}
              className={'nav-item nav-' + n.id + (view === n.id ? ' active' : '')}
              onClick={() => setView(n.id)}
              aria-current={view === n.id ? 'page' : undefined}
            >
              {n.label}
            </button>
          ))}
        </nav>
        <div className="services">
          <div className="services-title">Upstreams</div>
          {services.map((s) => (
            <div key={s.name} className="service-row">
              <span className={`dot ${s.status === 'live' || s.status === 'connected' ? 'dot-live' : 'dot-down'}`} />
              <span className="service-label">{s.label}</span>
              <span className="service-domain muted">{s.domain}</span>
            </div>
          ))}
          {services.length === 0 && <div className="muted small" role={servicesError ? 'alert' : 'status'}>{servicesError ? `Source status unavailable: ${servicesError}` : 'Checking source status…'}</div>}
        </div>
        <div className="sidebar-foot muted small">
          One guided climate mission, connected to the original project tools and their own evidence.
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <h1 className="topbar-title">{nav.title}</h1>
          <button type="button" className="command-open" onClick={() => setCommandOpen(true)} aria-label="Open command palette">Search <kbd>⌘K</kbd></button>
          <div className="muted small">as of {data ? new Date(data.asOf).toLocaleTimeString() : '…'}</div>
        </header>
        <div className={`memory-gate-strip ${memoryChecking ? 'checking' : memorySnapshot?.complete ? 'ready' : 'unavailable'}`} role="status">
          <span className="memory-gate-pulse" />
          <div className="memory-gate-copy"><strong>{memoryChecking ? 'CHECKING LOCAL MEMORY VAULT' : memorySnapshot?.complete ? 'LOCAL MEMORY VAULT · READY' : 'LOCAL MEMORY VAULT · STOP'}</strong><span>{memoryChecking ? 'Checking the local sandbox before agent work' : memorySnapshot?.complete ? `${memorySnapshot.activeCount} active judgments · install MCP in each agent · complete SHA-256 scan ${memorySnapshot.manifestSha256.slice(0, 12)}…` : memoryError || 'Do not continue coding until complete memory recall is restored.'}</span></div>
          <button type="button" onClick={openMemory}>{memorySnapshot?.complete ? 'Review memory' : 'Open recall gate'}</button>
        </div>
        {error && view !== 'memory' && <div className="error">Gateway unreachable: {error}. Start it with `node gateway/gateway.mjs`.</div>}
        {!data && !error && view !== 'memory' && <div className="muted">Loading the chain…</div>}
        <WorkspaceErrorBoundary key={view} label={nav.title}>
          {view === 'memory' && <AgentMemory focusMemoryId={focusMemoryId} onSnapshot={updateMemoryGate} />}
          {data && view === 'overview' && <OverviewView data={data} apps={projectApps} onNavigate={navigate} onMission={(stage) => { setActiveStage(stage); navigate('mission'); }} onCapabilities={() => navigate('capabilities')} onStudio={() => navigate('studio')} />}
          <Suspense fallback={<div className="loading-panel">Opening the workspace…</div>}>
            {view === 'mission' && <MissionPath data={data} activeStage={activeStage} onStage={setActiveStage} focus={focus} onFocus={setFocus} onNavigate={navigate} />}
            {view === 'studio' && <MissionStudio data={data} loading={!data && !error} focus={focus} onFocus={setFocus} selection={studioSelection} onSelection={setStudioSelection} title={studioTitle} onTitle={setStudioTitle} place={studioPlace} onPlace={setStudioPlace} onNavigate={navigate} focusMissionId={focusMissionId} />}
            {view === 'capabilities' && <CapabilityLibrary onNavigate={navigate} />}
            {data && view === 'cascade' && <CascadeReview data={data} siteId={cascadeSiteId} onBack={() => navigate('waste')} />}
          </Suspense>
          {data && view === 'waste' && <Waste data={data} onReview={(siteId) => { setCascadeSiteId(siteId); navigate('cascade'); }} />}
          {data && view === 'fire' && <Fire data={data} />}
          {data && view === 'water' && <Water data={data} />}
          {data && view === 'air' && <Air data={data} city={city} onCity={setCity} />}
        </WorkspaceErrorBoundary>
      </main>
      <CommandPalette open={commandOpen} onClose={() => setCommandOpen(false)} onNavigate={navigate} memories={memorySnapshot?.activeEntries ?? []} />
    </div>
  );
}
