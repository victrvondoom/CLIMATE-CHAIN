// Clean, spacious dashboard shell with optional view drawer and pinned grid comparison.

import { Suspense, useEffect, useState, type ReactNode } from 'react';
import { WorkspaceErrorBoundary } from '../components/WorkspaceErrorBoundary';
import { Icon } from '../components/Icon';
import { STAGES, type WorkspaceView } from '../data/capabilities';
import { DESTINATIONS, LIBRARY_GROUPS, destinationFor, isDestination, type Destination } from './library';
import { MAX_PINNED, PIN_REQUEST_EVENT, canPin, pinnedGridPrefs, readPrefs, togglePinned, writePrefs, type DashboardLayout, type DashboardPrefs } from './prefs';
import './dashboard.css';

interface DashboardProps {
  active: WorkspaceView;
  onOpen: (view: WorkspaceView) => void;
  renderView: (view: WorkspaceView) => ReactNode;
}

export function Dashboard({ active, onOpen, renderView }: DashboardProps) {
  const [prefs, setPrefs] = useState<DashboardPrefs>(() => readPrefs(isDestination));
  const [_storageOk, setStorageOk] = useState(true);
  const [filter, setFilter] = useState('');
  const [libraryOpen, setLibraryOpen] = useState(false);
  const isModule = (view: WorkspaceView) => destinationFor(view)?.group === 'modules';
  const [_modulesOpen, setModulesOpen] = useState(() => isModule(active));

  const [openedFor, setOpenedFor] = useState(active);
  if (openedFor !== active) {
    setOpenedFor(active);
    if (isModule(active)) setModulesOpen(true);
  }

  const needle = filter.trim().toLocaleLowerCase();

  const save = (next: DashboardPrefs) => {
    setPrefs(next);
    setStorageOk(writePrefs(next));
  };

  useEffect(() => {
    const onRequest = (event: Event) => {
      const next = pinnedGridPrefs((event as CustomEvent<unknown>).detail, isDestination);
      if (!next) return;
      setPrefs(next);
      setStorageOk(writePrefs(next));
    };
    window.addEventListener(PIN_REQUEST_EVENT, onRequest);
    return () => window.removeEventListener(PIN_REQUEST_EVENT, onRequest);
  }, []);

  const open = (id: WorkspaceView) => {
    setLibraryOpen(false);
    onOpen(id);
  };
  const setLayout = (layout: DashboardLayout) => save({ ...prefs, layout });
  const pin = (id: string) => save({ ...prefs, pinned: togglePinned(prefs.pinned, id) });

  const activeDestination = destinationFor(active);
  const pinnedViews = prefs.pinned.map((id) => destinationFor(id)).filter((item): item is Destination => !!item);
  const showGrid = prefs.layout === 'grid' && pinnedViews.length > 0;
  const visible = DESTINATIONS.filter((item) => !needle || item.label.toLocaleLowerCase().includes(needle));
  const moduleCount = visible.filter((item) => item.group === 'modules').length;

  const renderItem = (item: Destination) => {
    const isActive = item.id === active;
    const isPinned = prefs.pinned.includes(item.id);
    const blocked = !isPinned && !canPin(prefs.pinned, item.id);
    return (
      <div key={item.id} className={'dash-item' + (isActive ? ' active' : '')}>
        <button type="button" className="dash-open" aria-current={isActive ? 'page' : undefined} onClick={() => open(item.id)}>
          {item.label}
        </button>
        <button
          type="button"
          className="dash-pin"
          aria-pressed={isPinned}
          aria-label={`${isPinned ? 'Unpin' : 'Pin'} ${item.label}`}
          title={blocked ? `Unpin a view first. The grid holds ${MAX_PINNED}.` : undefined}
          disabled={blocked}
          onClick={() => pin(item.id)}
        >
          {isPinned ? 'Pinned' : 'Pin'}
        </button>
      </div>
    );
  };

  const renderPanel = (item: Destination, inGrid: boolean) => (
    <section key={item.id} className={inGrid ? 'dash-panel' : 'dash-focus'} aria-label={item.label}>
      {inGrid && (
        <header className="dash-panel-bar">
          <h2>{item.label}</h2>
          <div className="dash-panel-actions">
            <button type="button" onClick={() => open(item.id)} aria-label={`Focus ${item.label}`}>
              Focus
            </button>
            <button type="button" onClick={() => pin(item.id)} aria-label={`Unpin ${item.label}`}>
              Unpin
            </button>
          </div>
        </header>
      )}
      <WorkspaceErrorBoundary key={item.id} label={item.label}>
        <Suspense fallback={<div className="loading-panel">Opening {item.label}…</div>}>
          {renderView(item.id)}
        </Suspense>
      </WorkspaceErrorBoundary>
    </section>
  );

  return (
    <div className="dash-clean-wrapper">
      {/* Top action toolbar for layout switching & quick explorer */}
      <div className="dash-toolbar-clean">
        <div className="dash-toolbar-left">
          <button
            type="button"
            className={`dash-library-btn ${libraryOpen ? 'active' : ''}`}
            onClick={() => setLibraryOpen((v) => !v)}
            aria-expanded={libraryOpen}
          >
            <Icon name="layers" size={16} />
            <span>All views</span>
            <span className="badge-count">{DESTINATIONS.length}</span>
          </button>

          <div className="dash-layout-toggle" role="group" aria-label="Dashboard layout">
            <button
              type="button"
              className={prefs.layout === 'focus' ? 'active' : ''}
              onClick={() => setLayout('focus')}
            >
              <Icon name="dashboard" size={15} />
              Single view
            </button>
            <button
              type="button"
              className={prefs.layout === 'grid' ? 'active' : ''}
              onClick={() => setLayout('grid')}
            >
              <Icon name="grid" size={15} />
              Side-by-side <span className="seg-count">{prefs.pinned.length}</span>
            </button>
          </div>
        </div>

        <div className="dash-toolbar-right">
          {activeDestination && !showGrid && (
            <button
              type="button"
              className="dash-pin-action"
              aria-pressed={prefs.pinned.includes(active)}
              disabled={!prefs.pinned.includes(active) && !canPin(prefs.pinned, active)}
              onClick={() => pin(active)}
            >
              <Icon name="pin" size={15} />
              {prefs.pinned.includes(active) ? 'Pinned to grid' : 'Pin to grid'}
            </button>
          )}
        </div>
      </div>

      {/* Floating or collapsible view drawer */}
      {libraryOpen && (
        <div className="view-drawer-backdrop" onClick={() => setLibraryOpen(false)}>
          <div className="view-drawer-modal" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-header">
              <h3>All Climate Chain views</h3>
              <button
                type="button"
                className="drawer-close"
                onClick={() => setLibraryOpen(false)}
              >
                <Icon name="close" size={16} />
              </button>
            </div>

            <div className="drawer-search">
              <input
                type="search"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Search across all 18 views and modules…"
                autoFocus
              />
            </div>

            <div className="drawer-groups-scroll">
              {LIBRARY_GROUPS.filter((group) => group.id !== 'modules').map((group) => {
                const items = visible.filter((item) => item.group === group.id);
                if (items.length === 0) return null;
                return (
                  <section key={group.id} className="drawer-group">
                    <h4>{group.label}</h4>
                    <div className="drawer-items-grid">
                      {items.map(renderItem)}
                    </div>
                  </section>
                );
              })}

              {moduleCount > 0 && (
                <section className="drawer-group">
                  <h4>Native Project Modules ({moduleCount})</h4>
                  <div className="drawer-items-grid">
                    {STAGES.map((stage) => {
                      const items = visible.filter(
                        (item) => item.group === 'modules' && item.stage === stage.id
                      );
                      if (items.length === 0) return null;
                      return (
                        <div key={stage.id} className="stage-subgroup">
                          <span className="stage-tag">{stage.number} {stage.title}</span>
                          {items.map(renderItem)}
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Main Full-Width Content Stage */}
      <div className="dash-stage-full">
        {prefs.layout === 'grid' && !showGrid && (
          <div className="grid-empty-hint">
            <p>Pin up to {MAX_PINNED} views with “Pin to grid” to compare them side by side.</p>
          </div>
        )}

        {showGrid
          ? <div className="dash-grid">{pinnedViews.map((item) => renderPanel(item, true))}</div>
          : activeDestination && renderPanel(activeDestination, false)}
      </div>
    </div>
  );
}
