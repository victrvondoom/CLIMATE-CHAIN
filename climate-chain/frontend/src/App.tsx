import { lazy, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { CITIES, fetchAgentMemory, fetchOverview, getCachedOverview, fetchProjectApps, fetchServices, type AgentMemorySnapshot, type CityKey } from './api';
import { Overview as OverviewView } from './modules/Overview';
import { Waste } from './modules/Waste';
import { Fire } from './modules/Fire';
import { Water } from './modules/Water';
import { Air } from './modules/Air';
import { CAPABILITIES, type FocusId, type StageId, type WorkspaceView } from './data/capabilities';
import { AgentMemory } from './modules/AgentMemory';
import { ConnectionEvidence } from './modules/ConnectionEvidence';
import { ModuleScreen, findModule } from './modules/ModuleScreen';
import { EvidenceLedger } from './modules/EvidenceLedger';
import { SessionDesk } from './modules/SessionDesk';
import { CommandPalette } from './components/CommandPalette';
import { useLiveQuery } from './hooks/useLiveQuery';
import { useTheme } from './hooks/useTheme';
import { SignalContext } from './core/signals';
import { Dashboard } from './dashboard/Dashboard';
import { DEFAULT_VIEW, destinationFor, resolveView } from './dashboard/library';
import { placeForCity } from './core/places';
import { DEFAULT_OVERVIEW } from './data/defaultOverview';

const MissionPath = lazy(() => import('./modules/Workspace').then((module) => ({ default: module.MissionPath })));
const MissionStudio = lazy(() => import('./modules/MissionStudio').then((module) => ({ default: module.MissionStudio })));
const CascadeReview = lazy(() => import('./modules/CascadeReview').then((module) => ({ default: module.CascadeReview })));
const EarthWorkspace = lazy(() => import('./modules/earth/EarthWorkspace').then((module) => ({ default: module.EarthWorkspace })));
const IntegrityLab = lazy(() => import('./modules/IntegrityLab').then((module) => ({ default: module.IntegrityLab })));
const CausalLab = lazy(() => import('./modules/lab/CausalLab').then((module) => ({ default: module.CausalLab })));
const PollutionAtlas = lazy(() => import('./modules/pollution/PollutionAtlas').then((module) => ({ default: module.PollutionAtlas })));
const ClimateTimeline = lazy(() => import('./modules/ClimateTimeline').then((module) => ({ default: module.ClimateTimeline })));
const DataRefinery = lazy(() => import('./modules/refinery/DataRefinery').then((module) => ({ default: module.DataRefinery })));

export default function App() {
  const [view, setView] = useState<WorkspaceView>(() => resolveView(window.location.hash) ?? DEFAULT_VIEW);
  const [activeStage, setActiveStage] = useState<StageId>('sense');
  const [focus, setFocus] = useState<FocusId>('farmland');
  const [studioSelection, setStudioSelection] = useState<string[]>(() => CAPABILITIES.map((item) => item.id));
  const [studioTitle, setStudioTitle] = useState('Climate action mission');
  const [studioPlace, setStudioPlace] = useState('');
  const [city, setCity] = useState<CityKey>('delhi');
  const [cascadeSiteId, setCascadeSiteId] = useState<string | null>(null);
  const [commandOpen, setCommandOpen] = useState(false);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [focusMemoryId, setFocusMemoryId] = useState<string | null>(null);
  const [focusMissionId, setFocusMissionId] = useState<string | null>(null);
  const { theme, toggleTheme } = useTheme();

  const loadOverview = useCallback((signal: AbortSignal) => fetchOverview(city, signal), [city]);
  const overviewQuery = useLiveQuery(loadOverview, { key: city, allowOffline: true });
  const servicesQuery = useLiveQuery(fetchServices, { intervalMs: 60_000, allowOffline: true });
  const projectsQuery = useLiveQuery(fetchProjectApps, { intervalMs: 60_000, allowOffline: true });
  const memoryQuery = useLiveQuery(fetchAgentMemory, { intervalMs: 15_000, allowOffline: true });
  const data = overviewQuery.data ?? getCachedOverview(city) ?? DEFAULT_OVERVIEW;
  const error = overviewQuery.error;
  const services = servicesQuery.data?.services ?? [];
  const servicesError = servicesQuery.error;
  const projectApps = useMemo(() => Object.fromEntries((projectsQuery.data?.apps ?? []).map((app) => [app.id, app])), [projectsQuery.data]);
  const memorySnapshot = memoryQuery.error || !memoryQuery.online ? null : memoryQuery.data;
  const memoryChecking = memoryQuery.loading;
  const refreshMemoryGate = memoryQuery.refresh;
  const updateMemoryGate = useCallback((_snapshot: AgentMemorySnapshot | null) => { void refreshMemoryGate(); }, [refreshMemoryGate]);
  const refreshAll = () => { void overviewQuery.refresh(); void servicesQuery.refresh(); void projectsQuery.refresh(); void refreshMemoryGate(); };

  useEffect(() => {
    if (window.location.hash.slice(1) !== view) window.location.hash = view;
  }, [view]);
  useEffect(() => {
    const onHash = () => {
      const target = resolveView(window.location.hash);
      if (target) setView(target);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
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

  const destination = destinationFor(view);
  const title = destination?.title ?? 'Climate Chain';

  const navigate = (destinationView: WorkspaceView, memoryId?: string, missionId?: string) => {
    setNavigationOpen(false);
    setFocusMemoryId(memoryId ?? null);
    setFocusMissionId(missionId ?? null);
    setView(destinationView);
  };
  const openMemory = () => {
    navigate('memory');
    void refreshMemoryGate();
  };

  const renderView = (id: WorkspaceView): ReactNode => {
    if (id.startsWith('module:')) {
      const climateModule = findModule(id.slice('module:'.length));
      return climateModule && <ModuleScreen key={climateModule.id} climateModule={climateModule} onOpenReview={() => navigate('session')} onOpenLedger={() => navigate('ledger')} />;
    }
    switch (id) {
      case 'overview':
        return data ? (
          <OverviewView data={data} apps={projectApps} services={services} servicesError={servicesError} onOpen={navigate} onNavigate={navigate} onMission={(stage) => { setActiveStage(stage); navigate('mission'); }} onStudio={() => navigate('studio')} onModule={(moduleId) => navigate(`module:${moduleId}`)} onEarth={() => navigate('earth')} onIntegrity={() => navigate('integrity')} />
        ) : (
          <div className="overview-loading-skeleton">
            <div className="pulse-loader">
              <span className="live-status-dot" />
              <span>Connecting to live climate sensors and 18 module feeds…</span>
            </div>
          </div>
        );
      case 'connections': return <ConnectionEvidence data={data} services={services} servicesError={servicesError} onRefresh={refreshAll} onOpen={navigate} />;
      case 'earth': return <EarthWorkspace initialPlace={placeForCity(city)} />;
      case 'pollution': return <PollutionAtlas />;
      case 'refinery': return <DataRefinery />;
      case 'mission': return <MissionPath data={data} activeStage={activeStage} onStage={setActiveStage} focus={focus} onFocus={setFocus} onNavigate={navigate} />;
      case 'studio': return <MissionStudio data={data} loading={!data && !error} focus={focus} onFocus={setFocus} selection={studioSelection} onSelection={setStudioSelection} title={studioTitle} onTitle={setStudioTitle} place={studioPlace} onPlace={setStudioPlace} onNavigate={navigate} focusMissionId={focusMissionId} />;
      case 'cascade': return data && <CascadeReview data={data} siteId={cascadeSiteId} onBack={() => navigate('waste')} />;
      case 'waste': return data && <Waste data={data} onReview={(siteId) => { setCascadeSiteId(siteId); navigate('cascade'); }} />;
      case 'fire': return data && <Fire data={data} />;
      case 'water': return data && <Water data={data} />;
      case 'air': return data && <Air data={data} city={city} onCity={setCity} />;
      case 'session': return <SessionDesk onOpenModule={(moduleId) => navigate(`module:${moduleId}`)} />;
      case 'ledger': return <EvidenceLedger onOpenModule={(moduleId) => navigate(moduleId === 'earth' ? 'earth' : `module:${moduleId}`)} onOpenReview={() => navigate('session')} />;
      case 'integrity': return <IntegrityLab />;
      case 'timeline': return <ClimateTimeline onSendToFirewall={() => navigate('integrity')} />;
      case 'lab': return <CausalLab onNavigate={navigate} />;
      case 'memory': return <AgentMemory onSnapshot={updateMemoryGate} focusMemoryId={focusMemoryId} />;
      default: return null;
    }
  };

  return (
    <SignalContext.Provider value={overviewQuery}>
    <div className="app app-modern">
      {/* Sleek, Unified Modern Sidebar */}
      <aside className={`sidebar-modern${navigationOpen ? ' navigation-open' : ''}`}>
        <div className="sidebar-brand">
          <div className="brand-badge">CC</div>
          <div className="brand-info">
            <span className="brand-title">Climate Chain</span>
            <span className="brand-tagline">One Mission</span>
          </div>
          <button
            type="button"
            className="theme-toggle-btn"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          >
            {theme === 'dark' ? '☀' : '☾'}
          </button>
          <button
            type="button"
            className="mobile-close-btn"
            onClick={() => setNavigationOpen(false)}
            aria-label="Close menu"
          >
            ✕
          </button>
        </div>

        <nav id="climate-navigation" className="nav-menu" aria-label="Main navigation">
          {/* Main Dashboard */}
          <button
            type="button"
            className={`nav-button ${view === DEFAULT_VIEW ? 'active' : ''}`}
            onClick={() => navigate(DEFAULT_VIEW)}
          >
            <span className="nav-icon">🏠</span>
            <span className="nav-text">Command Center</span>
          </button>

          {/* Quick Search */}
          <button
            type="button"
            className="nav-search-button"
            onClick={() => setCommandOpen(true)}
          >
            <span className="nav-icon">🔍</span>
            <span className="nav-text">Search Everything</span>
            <kbd className="nav-kbd">⌘K</kbd>
          </button>

          {/* Climate Signals Section */}
          <div className="nav-section-title">CLIMATE SIGNALS</div>
          <button
            type="button"
            className={`nav-button ${view === 'waste' ? 'active' : ''}`}
            onClick={() => navigate('waste')}
          >
            <span className="nav-icon">🗑️</span>
            <span className="nav-text">Waste · JunkSnap</span>
          </button>
          <button
            type="button"
            className={`nav-button ${view === 'fire' ? 'active' : ''}`}
            onClick={() => navigate('fire')}
          >
            <span className="nav-icon">🔥</span>
            <span className="nav-text">Fire · ClearSky</span>
          </button>
          <button
            type="button"
            className={`nav-button ${view === 'water' ? 'active' : ''}`}
            onClick={() => navigate('water')}
          >
            <span className="nav-icon">💧</span>
            <span className="nav-text">Water · Teesri Shikayat</span>
          </button>
          <button
            type="button"
            className={`nav-button ${view === 'air' ? 'active' : ''}`}
            onClick={() => navigate('air')}
          >
            <span className="nav-icon">💨</span>
            <span className="nav-text">Air · Vayu Project</span>
          </button>
          <button
            type="button"
            className={`nav-button ${view === 'pollution' ? 'active' : ''}`}
            onClick={() => navigate('pollution')}
          >
            <span className="nav-icon">🌫️</span>
            <span className="nav-text">Global Pollution Atlas</span>
          </button>

          {/* Mission & Verification Section */}
          <div className="nav-section-title">MISSIONS & INTEGRITY</div>
          <button
            type="button"
            className={`nav-button ${view === 'mission' ? 'active' : ''}`}
            onClick={() => navigate('mission')}
          >
            <span className="nav-icon">🎯</span>
            <span className="nav-text">5-Step Mission Flow</span>
          </button>
          <button
            type="button"
            className={`nav-button ${view === 'timeline' ? 'active' : ''}`}
            onClick={() => navigate('timeline')}
          >
            <span className="nav-icon">⏳</span>
            <span className="nav-text">200-Year Timeline</span>
          </button>
          <button
            type="button"
            className={`nav-button ${view === 'lab' ? 'active' : ''}`}
            onClick={() => navigate('lab')}
          >
            <span className="nav-icon">🧪</span>
            <span className="nav-text">Causal Lab</span>
          </button>
          <button
            type="button"
            className={`nav-button ${view === 'earth' ? 'active' : ''}`}
            onClick={() => navigate('earth')}
          >
            <span className="nav-icon">🛰️</span>
            <span className="nav-text">Earth & Satellite</span>
          </button>
          <button
            type="button"
            className={`nav-button ${view === 'integrity' ? 'active' : ''}`}
            onClick={() => navigate('integrity')}
          >
            <span className="nav-icon">🛡️</span>
            <span className="nav-text">Climate Integrity Lab</span>
          </button>
          <button
            type="button"
            className={`nav-button ${view === 'ledger' ? 'active' : ''}`}
            onClick={() => navigate('ledger')}
          >
            <span className="nav-icon">📜</span>
            <span className="nav-text">Evidence Ledger</span>
          </button>

          {/* Research Tools Section */}
          <div className="nav-section-title">RESEARCH TOOLS</div>
          <button
            type="button"
            className={`nav-button ${view === 'refinery' ? 'active' : ''}`}
            onClick={() => navigate('refinery')}
          >
            <span className="nav-icon">🧹</span>
            <span className="nav-text">Data Refinery</span>
          </button>
        </nav>

        {/* Upstreams Live Connection Status */}
        <div className="sidebar-upstreams-box">
          <div className="upstreams-header">
            <span>LIVE UPSTREAMS</span>
            <button
              type="button"
              className="refresh-mini-btn"
              onClick={() => void servicesQuery.refresh()}
              disabled={servicesQuery.refreshing}
              title="Refresh source connections"
            >
              ↻
            </button>
          </div>
          <div className="upstreams-list">
            {services.map((s) => (
              <div key={s.name} className="upstream-item">
                <span className={`live-dot ${s.status === 'live' || s.status === 'connected' ? 'live' : 'standby'}`} />
                <span className="upstream-name">{s.label}</span>
                <span className="upstream-mode">{s.status === 'live' ? 'LIVE' : 'SYNCED'}</span>
              </div>
            ))}
          </div>
        </div>
      </aside>

      {/* Main Spacious Content Canvas */}
      <main className="main-content-canvas">
        {/* Sleek Topbar */}
        <header className="topbar-modern">
          <div className="topbar-left">
            <button
              type="button"
              className="mobile-nav-toggle"
              onClick={() => setNavigationOpen((o) => !o)}
              aria-label="Open navigation menu"
            >
              ☰
            </button>
            <div className="page-breadcrumb">
              <span className="breadcrumb-root">Climate Chain</span>
              <span className="breadcrumb-separator">/</span>
              <span className="breadcrumb-current">{title}</span>
            </div>
          </div>

          <div className="topbar-right">
            {/* Dynamic City Switcher */}
            {view !== 'earth' && (
              <div className="city-selector-pill">
                <span className="city-icon">📍</span>
                <select
                  value={city}
                  onChange={(e) => setCity(e.target.value as CityKey)}
                  aria-label="Select Monitored Region"
                >
                  {Object.entries(CITIES).map(([id, place]) => (
                    <option key={id} value={id}>
                      {place.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Quick Search */}
            <button
              type="button"
              className="topbar-search-btn"
              onClick={() => setCommandOpen(true)}
              aria-label="Search"
            >
              <span>Search</span>
              <kbd>⌘K</kbd>
            </button>

            {/* Memory Vault Pill */}
            <button
              type="button"
              className={`vault-status-pill ${memoryChecking ? 'checking' : memorySnapshot?.complete ? 'ready' : 'standby'}`}
              onClick={openMemory}
              title={memorySnapshot?.complete ? 'Memory vault verified' : 'Click to inspect verification status'}
            >
              <span className="vault-dot" />
              <span>{memoryChecking ? 'Checking Vault' : memorySnapshot?.complete ? 'Vault Verified' : 'Vault Ready'}</span>
            </button>

            {/* Live Refresh Trigger */}
            <button
              type="button"
              className={`refresh-round-btn ${overviewQuery.refreshing ? 'rotating' : ''}`}
              onClick={refreshAll}
              title="Refresh all climate feeds"
              aria-label="Refresh feeds"
            >
              ↻
            </button>
          </div>
        </header>

        {/* Dashboard stage */}
        <Dashboard active={view} onOpen={(next) => navigate(next)} renderView={renderView} />
      </main>

      <CommandPalette
        open={commandOpen}
        onClose={() => setCommandOpen(false)}
        onNavigate={navigate}
        memories={memorySnapshot?.activeEntries ?? []}
      />
    </div>
    </SignalContext.Provider>
  );
}
