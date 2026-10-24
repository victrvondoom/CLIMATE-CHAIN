import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { CAPABILITIES, type WorkspaceView } from '../data/capabilities';
import type { AgentMemoryEntry } from '../api';
import { CLIMATE_MODULES } from '../modules';

interface Command { id: string; label: string; detail: string; view: WorkspaceView; memoryId?: string; missionId?: string }
interface SavedMissionChoice { id: string; title: string; status: string }

function readSavedMissions(): SavedMissionChoice[] {
  try {
    const raw = localStorage.getItem('climate-chain.missions.v1');
    if (!raw || raw.length > 2_000_000) return [];
    const parsed: unknown = JSON.parse(raw);
    const records = parsed && typeof parsed === 'object' && 'schemaVersion' in parsed && parsed.schemaVersion === 1 && 'missions' in parsed && Array.isArray(parsed.missions) ? parsed.missions : [];
    return records.filter((item): item is SavedMissionChoice => !!item && typeof item === 'object'
      && typeof item.id === 'string' && item.id.length <= 100
      && typeof item.title === 'string' && item.title.trim().length > 0 && item.title.length <= 160
      && typeof item.status === 'string').slice(0, 50);
  } catch {
    return [];
  }
}

export function CommandPalette({ open, onClose, onNavigate, memories = [] }: { open: boolean; onClose: () => void; onNavigate: (view: WorkspaceView, memoryId?: string, missionId?: string) => void; memories?: AgentMemoryEntry[] }) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [savedMissions, setSavedMissions] = useState<SavedMissionChoice[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const commands = useMemo<Command[]>(() => [
    { id: 'earth', label: 'Satellite climate globe', detail: 'Cesium · weather · air quality · carbon · supply chains', view: 'earth' },
    { id: 'overview', label: 'Command center', detail: 'Workspace', view: 'overview' },
    { id: 'studio', label: 'Mission Studio', detail: 'Create and review missions', view: 'studio' },
    { id: 'memory', label: 'Engineering Memory', detail: 'Recall gate and judgment vault', view: 'memory' },
    ...CAPABILITIES.map((item) => ({ id: item.id, label: item.name, detail: `${item.domain} · ${item.readiness}`, view: (item.module ?? 'capabilities') as WorkspaceView })),
    { id: 'ledger', label: 'Evidence ledger', detail: 'Every recorded outcome, with a digest check', view: 'ledger' },
    { id: 'timeline', label: 'Climate Intelligence Timeline', detail: '200 years of environmental evidence (1826-2026) · NOAA, NASA, Law Dome, Mauna Loa', view: 'timeline' },
    { id: 'integrity', label: 'Climate Integrity Lab', detail: 'Signal to on-chain proof · tamper, replay, duplicate claim, challenge, correction', view: 'integrity' },
    ...CLIMATE_MODULES.map((item) => ({ id: `module-${item.id}`, label: item.name, detail: `Native module · ${item.stages.join(' · ')} · ${item.mode}`, view: `module:${item.id}` as WorkspaceView })),
    ...memories.filter((entry) => entry.status === 'active').map((entry) => ({ id: `memory-${entry.id}`, label: entry.title, detail: `Memory · ${entry.scope} · ${entry.rule.slice(0, 110)}`, view: 'memory' as WorkspaceView, memoryId: entry.id })),
    ...savedMissions.map((mission) => ({ id: `mission-${mission.id}`, label: mission.title, detail: `Saved mission · ${mission.status} · local browser history`, view: 'studio' as WorkspaceView, missionId: mission.id })),
  ], [memories, savedMissions]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return commands.filter((item) => !needle || `${item.label} ${item.detail}`.toLocaleLowerCase().includes(needle));
  }, [commands, query]);

  useEffect(() => {
    if (!open) {
      setQuery(''); setActiveIndex(0);
      returnFocusRef.current?.focus();
      return;
    }
    setSavedMissions(readSavedMissions());
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    inputRef.current?.focus();
  }, [open]);
  useEffect(() => { setActiveIndex(0); }, [query]);
  if (!open) return null;

  const select = (command: Command | undefined) => {
    if (!command) return;
    onNavigate(command.view, command.memoryId, command.missionId);
    onClose();
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); onClose(); }
    else if (event.key === 'ArrowDown') { event.preventDefault(); setActiveIndex((index) => Math.min(index + 1, filtered.length - 1)); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex((index) => Math.max(index - 1, 0)); }
    else if (event.key === 'Enter') { event.preventDefault(); select(filtered[activeIndex]); }
    else if (event.key === 'Tab') {
      const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('input, button:not(:disabled)'));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  };

  return <div className="command-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="command-dialog" role="dialog" aria-modal="true" aria-labelledby="command-title" onKeyDown={handleKeyDown}>
      <h2 id="command-title" className="sr-only">Search Climate Chain</h2>
      <label className="command-input-wrap"><span aria-hidden="true">⌕</span><input ref={inputRef} role="combobox" aria-expanded="true" aria-autocomplete="list" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search pages, memories, and missions…" aria-label="Search pages, memories, and missions" aria-controls="command-results" aria-activedescendant={filtered[activeIndex] ? `command-option-${filtered[activeIndex].id}` : undefined} /><kbd>ESC</kbd></label>
      <div id="command-results" className="command-results" role="listbox" aria-label="Commands" aria-live="polite">
        {filtered.map((command, index) => <button type="button" role="option" id={`command-option-${command.id}`} aria-selected={index === activeIndex} className={'command-option' + (index === activeIndex ? ' active' : '')} key={command.id} onMouseEnter={() => setActiveIndex(index)} onClick={() => select(command)}>
          <span className="command-option-mark" aria-hidden="true">{command.id === 'memory' ? '◇' : command.id === 'studio' ? '↗' : '⌁'}</span><span><strong>{command.label}</strong><small>{command.detail}</small></span><span className="command-option-enter">↵</span>
        </button>)}
        {!filtered.length && <p className="command-empty">No matching pages, memories, or missions.</p>}
      </div>
      <div className="command-footer"><span>↑↓ navigate</span><span>↵ open</span><span>⌘K / Ctrl K toggle</span></div>
    </div>
  </div>;
}
