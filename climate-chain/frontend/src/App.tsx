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
import { Icon, type IconName } from './components/Icon';

const NAV_GROUPS: { title: string; items: { view: WorkspaceView; label: string; icon: IconName }[] }[] = [
  {
    title: 'Climate signals',
    items: [
      { view: 'waste', label: 'Waste · DumpWatch', icon: 'waste' },
      { view: 'fire', label: 'Fire · AshAlert', icon: 'fire' },
      { view: 'water', label: 'Water · TapAlert', icon: 'water' },
      { view: 'air', label: 'Air · AirPulse', icon: 'air' },
      { view: 'pollution', label: 'Global Pollution Atlas', icon: 'cloud' },
    ],
  },
  {
    title: 'Missions & integrity',
    items: [
      { view: 'mission', label: '5-Step Mission Flow', icon: 'target' },
      { view: 'timeline', label: '200-Year Timeline', icon: 'hourglass' },
      { view: 'lab', label: 'Causal Lab', icon: 'flask' },
      { view: 'earth', label: 'Earth & Satellite', icon: 'globe' },
      { view: 'integrity', label: 'Climate Integrity Lab', icon: 'shield' },
      { view: 'ledger', label: 'Evidence Ledger', icon: 'ledger' },
    ],
  },
  {
    title: 'Research tools',
    items: [{ view: 'refinery', label: 'Data Refinery', icon: 'filter' }],
  },
];

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
              <span>Connecting to the 4 live project feeds…</span>
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
          <div className="brand-badge" aria-hidden="true">C</div>
          <div className="brand-info">
            <span className="brand-title">
              <span className="brand-title-classic">Climate</span>{' '}
              <em className="brand-title-cursive">Chain</em>
            </span>
            <span className="brand-tagline">
              <span className="brand-tagline-mono">SIGNAL</span>
              <span className="brand-tagline-arrow">/</span>
              <span className="brand-tagline-mono">PROOF</span>
            </span>
          </div>
          <button
            type="button"
            className="theme-toggle-btn"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          >
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={17} />
          </button>
          <button
            type="button"
            className="mobile-close-btn"
            onClick={() => setNavigationOpen(false)}
            aria-label="Close menu"
          >
            <Icon name="close" size={17} />
          </button>
        </div>

        <nav id="climate-navigation" className="nav-menu" aria-label="Main navigation">
          <button
            type="button"
            className={`nav-button ${view === DEFAULT_VIEW ? 'active' : ''}`}
            onClick={() => navigate(DEFAULT_VIEW)}
          >
            <span className="nav-icon"><Icon name="dashboard" /></span>
            <span className="nav-text">Command Center</span>
          </button>

          <button type="button" className="nav-search-button" onClick={() => setCommandOpen(true)}>
            <span className="nav-icon"><Icon name="search" /></span>
            <span className="nav-text">Search everything</span>
            <kbd className="nav-kbd">⌘K</kbd>
          </button>

          {NAV_GROUPS.map((group) => (
            <div key={group.title} className="nav-group" role="group" aria-label={group.title}>
              <div className="nav-section-title">{group.title}</div>
              {group.items.map((item) => (
                <button
                  key={item.view}
                  type="button"
                  className={`nav-button ${view === item.view ? 'active' : ''}`}
                  aria-current={view === item.view ? 'page' : undefined}
                  onClick={() => navigate(item.view)}
                >
                  <span className="nav-icon"><Icon name={item.icon} /></span>
                  <span className="nav-text">{item.label}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>

        {/* Upstreams Live Connection Status */}
        <div className="sidebar-upstreams-box">
          <div className="upstreams-header">
            <span>Live upstreams</span>
            <button
              type="button"
              className="refresh-mini-btn"
              onClick={() => void servicesQuery.refresh()}
              disabled={servicesQuery.refreshing}
              title="Refresh source connections"
            >
              <Icon name="refresh" size={14} />
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
              <Icon name="menu" size={18} />
            </button>
            <div className="page-breadcrumb">
              <span className="breadcrumb-root">Climate <em className="breadcrumb-cursive">Chain</em></span>
              <span className="breadcrumb-separator">/</span>
              <span className="breadcrumb-current">{title}</span>
            </div>
          </div>

          <div className="topbar-right">
            {/* Dynamic City Switcher */}
            {view !== 'earth' && (
              <div className="city-selector-pill">
                <Icon name="pointer" size={16} />
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
              <Icon name="refresh" size={17} />
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
