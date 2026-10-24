import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { calculateLegFootprint, calculateNetworkFootprint, calculateSiteFootprint, parseSupplyNetwork, SUPPLY_METHOD_SOURCES, SUPPLY_STORAGE_KEY, type IncomingSupplySite, type SupplyLeg, type SupplyNetwork, type SupplyPlace, type SupplySite } from './supply';
import './supply.css';

export interface SupplyChainPanelProps {
  selectedPlace: SupplyPlace | null;
  incomingSite?: IncomingSupplySite | null;
  onNetworkChange?: (network: SupplyNetwork) => void;
  onSelectSite?: (site: SupplySite) => void;
}

type SiteForm = Record<'name' | 'lat' | 'lng' | 'product' | 'outputQuantity' | 'outputUnit' | 'energyKwh' | 'gridKgCo2PerKwh' | 'processKgCo2e' | 'source' | 'evidenceUpdatedAt', string>;
type LegForm = Record<'fromSiteId' | 'toSiteId' | 'massTonnes' | 'transportFactorKgPerTonneKm' | 'source' | 'evidenceUpdatedAt', string>;
const EMPTY_SITE: SiteForm = { name: '', lat: '', lng: '', product: '', outputQuantity: '', outputUnit: '', energyKwh: '', gridKgCo2PerKwh: '', processKgCo2e: '', source: '', evidenceUpdatedAt: '' };
const EMPTY_LEG: LegForm = { fromSiteId: '', toSiteId: '', massTonnes: '', transportFactorKgPerTonneKm: '', source: '', evidenceUpdatedAt: '' };
const EMPTY_NETWORK: SupplyNetwork = { sites: [], legs: [] };
const numberText = (value: number | null | undefined) => value == null ? '' : String(value);
const quantity = (value: string) => value.trim() === '' ? null : Number(value);
const display = (value: number | null, digits = 2) => value === null ? 'UNKNOWN' : value.toLocaleString(undefined, { maximumFractionDigits: digits });
const message = (error: unknown) => error instanceof Error ? error.message : 'The supply network could not be updated.';

function initialNetwork() {
  try {
    const raw = localStorage.getItem(SUPPLY_STORAGE_KEY);
    return { network: raw ? parseSupplyNetwork(JSON.parse(raw)) : EMPTY_NETWORK, error: '', unreadable: false };
  } catch (error) {
    return { network: EMPTY_NETWORK, error: `Saved supply data could not be read: ${message(error)} Existing browser data was preserved. Changes will stay in this session until you explicitly save.`, unreadable: true };
  }
}

function siteForm(site: SupplySite): SiteForm {
  return { name: site.name, lat: String(site.lat), lng: String(site.lng), product: site.product, outputQuantity: numberText(site.outputQuantity), outputUnit: site.outputUnit, energyKwh: numberText(site.energyKwh), gridKgCo2PerKwh: numberText(site.gridKgCo2PerKwh), processKgCo2e: numberText(site.processKgCo2e), source: site.source, evidenceUpdatedAt: site.evidenceUpdatedAt };
}
function legForm(leg: SupplyLeg): LegForm {
  return { fromSiteId: leg.fromSiteId, toSiteId: leg.toSiteId, massTonnes: numberText(leg.massTonnes), transportFactorKgPerTonneKm: numberText(leg.transportFactorKgPerTonneKm), source: leg.source, evidenceUpdatedAt: leg.evidenceUpdatedAt };
}

export function SupplyChainPanel({ selectedPlace, incomingSite, onNetworkChange, onSelectSite }: SupplyChainPanelProps) {
  const [initial] = useState(initialNetwork);
  const [network, setNetwork] = useState<SupplyNetwork>(initial.network);
  const networkRef = useRef(network);
  const [storageError, setStorageError] = useState(initial.error);
  const unreadableRef = useRef(initial.unreadable);
  const dirtyRef = useRef(initial.unreadable);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [siteDraft, setSiteDraft] = useState<SiteForm>(EMPTY_SITE);
  const [legDraft, setLegDraft] = useState<LegForm>(EMPTY_LEG);
  const [editingSiteId, setEditingSiteId] = useState<string | null>(null);
  const [editingLegId, setEditingLegId] = useState<string | null>(null);
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);
  const [importCandidate, setImportCandidate] = useState<SupplyNetwork | null>(null);
  const [importName, setImportName] = useState('');
  const [importBusy, setImportBusy] = useState(false);
  const [comparisonGroup, setComparisonGroup] = useState('');
  const [sort, setSort] = useState<'name' | 'total' | 'intensity'>('name');
  const importSequence = useRef(0);
  const lastIncoming = useRef<string | null>(null);
  const incomingDraftId = useRef<string | null>(null);
  const editingBaseline = useRef<string | null>(null);
  const legBaseline = useRef<string | null>(null);
  const callbackRef = useRef(onNetworkChange);
  useEffect(() => { callbackRef.current = onNetworkChange; }, [onNetworkChange]);
  useEffect(() => { networkRef.current = network; callbackRef.current?.(network); }, [network]);
  useEffect(() => () => { importSequence.current += 1; }, []);

  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key !== SUPPLY_STORAGE_KEY && event.key !== null) return;
      if (dirtyRef.current) { setStorageError('Supply data changed in another tab while this session has unsaved changes. Export this session before replacing browser storage.'); return; }
      try {
        const raw = localStorage.getItem(SUPPLY_STORAGE_KEY);
        const next = raw ? parseSupplyNetwork(JSON.parse(raw)) : EMPTY_NETWORK;
        networkRef.current = next;
        setNetwork(next);
        setNotice('Supply network synchronized from another tab. Your form drafts were preserved.');
        setStorageError('');
      } catch (cause) { unreadableRef.current = true; dirtyRef.current = true; setStorageError(`Could not synchronize saved supply data: ${message(cause)} Browser data was preserved; use Export JSON to keep this session.`); }
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);

  useEffect(() => {
    if (!incomingSite) { lastIncoming.current = null; return; }
    const requestKey = `${incomingSite.id}:${incomingSite.requestKey ?? ''}`;
    if (lastIncoming.current === requestKey) return;
    lastIncoming.current = requestKey;
    incomingDraftId.current = incomingSite.id;
    const existing = networkRef.current.sites.find((site) => site.id === incomingSite.id);
    if (existing) {
      setSiteDraft(siteForm(existing)); setEditingSiteId(existing.id); editingBaseline.current = JSON.stringify(existing);
    } else {
      setSiteDraft({ ...EMPTY_SITE, name: incomingSite.name, lat: String(incomingSite.lat), lng: String(incomingSite.lng), product: incomingSite.product ?? '', source: incomingSite.sourceUrl });
      setEditingSiteId(null); editingBaseline.current = null;
    }
    setSelectedSiteId(existing?.id ?? null);
    setNotice('Facility location copied into the review form. Add production evidence and choose Save site to include it.');
  }, [incomingSite]);

  const total = useMemo(() => calculateNetworkFootprint(network), [network]);
  const inspectedSite = network.sites.find((site) => site.id === selectedSiteId) ?? null;
  const inspected = inspectedSite ? calculateSiteFootprint(inspectedSite) : null;
  const groups = useMemo(() => [...new Set(network.sites.map((site) => JSON.stringify([site.product, site.outputUnit])))], [network.sites]);
  const comparison = useMemo(() => network.sites.filter((site) => !comparisonGroup || JSON.stringify([site.product, site.outputUnit]) === comparisonGroup)
    .map((site) => ({ site, footprint: calculateSiteFootprint(site) }))
    .sort((a, b) => sort === 'name' ? a.site.name.localeCompare(b.site.name) : ((sort === 'total' ? a.footprint.totalKgCo2e : a.footprint.intensityKgPerUnit) ?? Infinity) - ((sort === 'total' ? b.footprint.totalKgCo2e : b.footprint.intensityKgPerUnit) ?? Infinity)), [network.sites, comparisonGroup, sort]);

  function persist(next: SupplyNetwork, explicit = false) {
    if (unreadableRef.current && !explicit) { dirtyRef.current = true; return false; }
    try {
      localStorage.setItem(SUPPLY_STORAGE_KEY, JSON.stringify({ schemaVersion: 1, ...next }));
      dirtyRef.current = false; unreadableRef.current = false; setStorageError(''); setSavedAt(new Date().toISOString());
      return true;
    } catch (cause) {
      dirtyRef.current = true;
      setStorageError(`Browser storage failed: ${message(cause)} Your changes remain in this session. Export JSON before closing this page.`);
      return false;
    }
  }
  function commit(next: SupplyNetwork, text: string) {
    const normalized = parseSupplyNetwork(next);
    networkRef.current = normalized; setNetwork(normalized); setError('');
    const saved = persist(normalized);
    setNotice(`${text} ${saved ? 'Saved in this browser.' : 'Available in this session; export JSON to keep it.'}`);
  }
  function clearSiteDraft() { setSiteDraft(EMPTY_SITE); setEditingSiteId(null); editingBaseline.current = null; incomingDraftId.current = null; }
  function clearLegDraft() { setLegDraft(EMPTY_LEG); setEditingLegId(null); legBaseline.current = null; }

  function saveSite(event: FormEvent) {
    event.preventDefault(); setError('');
    try {
      if (!siteDraft.lat.trim() || !siteDraft.lng.trim()) throw new Error('Latitude and longitude are required. Use the selected place or enter both coordinates.');
      const current = networkRef.current;
      if (editingSiteId && JSON.stringify(current.sites.find((site) => site.id === editingSiteId)) !== editingBaseline.current) throw new Error('This site changed or was removed in another tab. Your draft is preserved. Inspect the latest site and choose Edit to review that version.');
      const id = editingSiteId ?? (incomingDraftId.current && !current.sites.some((site) => site.id === incomingDraftId.current) ? incomingDraftId.current : crypto.randomUUID());
      const site: SupplySite = { id, ...siteDraft, lat: Number(siteDraft.lat), lng: Number(siteDraft.lng), outputQuantity: quantity(siteDraft.outputQuantity), energyKwh: quantity(siteDraft.energyKwh), gridKgCo2PerKwh: quantity(siteDraft.gridKgCo2PerKwh), processKgCo2e: quantity(siteDraft.processKgCo2e) };
      commit({ ...current, sites: editingSiteId ? current.sites.map((item) => item.id === editingSiteId ? site : item) : [...current.sites, site] }, editingSiteId ? 'Site updated.' : 'Site added.');
      setSelectedSiteId(id); clearSiteDraft();
    } catch (cause) { setError(message(cause)); }
  }
  function saveLeg(event: FormEvent) {
    event.preventDefault(); setError('');
    try {
      const current = networkRef.current;
      if (editingLegId && JSON.stringify(current.legs.find((leg) => leg.id === editingLegId)) !== legBaseline.current) throw new Error('This route changed in another tab. Your draft is preserved; inspect and edit its latest version.');
      const leg: SupplyLeg = { ...legDraft, id: editingLegId ?? crypto.randomUUID(), massTonnes: quantity(legDraft.massTonnes), transportFactorKgPerTonneKm: quantity(legDraft.transportFactorKgPerTonneKm) };
      commit({ ...current, legs: editingLegId ? current.legs.map((item) => item.id === editingLegId ? leg : item) : [...current.legs, leg] }, editingLegId ? 'Route leg updated.' : 'Route leg added.');
      clearLegDraft();
    } catch (cause) { setError(message(cause)); }
  }
  function removeSite(site: SupplySite) {
    const current = networkRef.current;
    const linked = current.legs.filter((leg) => leg.fromSiteId === site.id || leg.toSiteId === site.id).length;
    if (!window.confirm(`Remove ${site.name}${linked ? ` and ${linked} connected route leg(s)` : ''} from this browser's supply network?`)) return;
    commit({ sites: current.sites.filter((item) => item.id !== site.id), legs: current.legs.filter((leg) => leg.fromSiteId !== site.id && leg.toSiteId !== site.id) }, 'Site removed.');
    if (editingSiteId === site.id) clearSiteDraft();
    if (selectedSiteId === site.id) setSelectedSiteId(null);
  }
  async function importJson(file?: File) {
    if (!file) return;
    const sequence = ++importSequence.current;
    setImportBusy(true); setError(''); setImportCandidate(null);
    try {
      if (file.size > 2_000_000) throw new Error('Supply JSON import is limited to 2 MB.');
      const candidate = parseSupplyNetwork(JSON.parse(await file.text()));
      if (sequence !== importSequence.current) return;
      setImportCandidate(candidate); setImportName(file.name);
    } catch (cause) { if (sequence === importSequence.current) setError(message(cause)); }
    finally { if (sequence === importSequence.current) setImportBusy(false); }
  }
  function exportJson() {
    const payload = { schemaVersion: 1, exportedAt: new Date().toISOString(), status: 'USER_ENTERED_ESTIMATE_NOT_VERIFIED', boundary: 'Entered electricity, process estimates and geodesic freight legs only; no full lifecycle or certification claim.', ...networkRef.current, estimates: calculateNetworkFootprint(networkRef.current), methods: SUPPLY_METHOD_SOURCES };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'climate-chain-supply-network.json'; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000); setNotice('Supply network and estimate boundaries exported as JSON.');
  }

  return <section className="supply-panel" aria-label="Production sites, supply routes and carbon estimates">
    <header className="supply-heading"><div><span className="supply-eyebrow">YOUR NETWORK · ESTIMATED · NOT VERIFIED</span><h2>Production &amp; supply chains</h2><p>Add facilities and shipping links from your evidence. Missing inputs remain UNKNOWN.</p></div><button type="button" onClick={exportJson}>Export JSON</button></header>
    <div className="supply-summary" aria-label="Entered supply-network estimates"><div><small>Sites / route legs</small><strong>{network.sites.length} / {network.legs.length}</strong></div><div><small>Entered network estimate · kg CO₂e</small><strong>{display(total.totalKgCo2e)}</strong></div><div><small>Known component subtotal · kg CO₂e</small><strong>{display(total.knownSubtotalKgCo2e)}</strong></div><div><small>Incomplete components</small><strong>{total.unknownComponents}</strong></div></div>
    <p className="supply-boundary">Totals cover only the electricity, process and transport entries below. They are user estimates for a declared common period, with no verification of production, factor suitability, completeness or certification. A known subtotal is partial when any component is UNKNOWN.</p>
    {error && <p className="supply-error" role="alert">{error}</p>}{notice && <p className="supply-notice" role="status">{notice}</p>}
    {storageError && <div className="supply-error" role="alert"><p>{storageError}</p><button type="button" onClick={() => { if (unreadableRef.current && !window.confirm('Replace the unreadable browser supply data with this session’s current network?')) return; persist(networkRef.current, true); }}>Save this session to browser storage</button><button type="button" onClick={exportJson}>Export session JSON</button></div>}
    <p className="supply-storage">{savedAt ? `Saved locally ${new Date(savedAt).toLocaleTimeString()}` : initial.error ? 'Browser storage needs attention' : 'Stored in this browser after each saved change'} · form drafts remain unsaved until you choose Save.</p>

    <div className="supply-workbench">
      <form className="supply-form" onSubmit={saveSite}><div className="supply-subheading"><h3>{editingSiteId ? 'Edit production site' : 'Add production site'}</h3>{editingSiteId && <button type="button" onClick={clearSiteDraft}>Cancel edit</button>}</div>
        <label>Site name<input required maxLength={160} value={siteDraft.name} onChange={(event) => setSiteDraft({ ...siteDraft, name: event.target.value })} placeholder="Name from your facility evidence" /></label>
        <div className="supply-fields"><label>Latitude<input required type="number" min="-90" max="90" step="any" value={siteDraft.lat} onChange={(event) => setSiteDraft({ ...siteDraft, lat: event.target.value })} /></label><label>Longitude<input required type="number" min="-180" max="180" step="any" value={siteDraft.lng} onChange={(event) => setSiteDraft({ ...siteDraft, lng: event.target.value })} /></label></div>
        <button type="button" className="supply-quiet" disabled={!selectedPlace} onClick={() => selectedPlace && setSiteDraft({ ...siteDraft, lat: String(selectedPlace.lat), lng: String(selectedPlace.lng), name: siteDraft.name || selectedPlace.name })}>{selectedPlace ? `Use selected place · ${selectedPlace.name}` : 'Select a place on the globe to use its coordinates'}</button>
        <label>Product<input maxLength={160} value={siteDraft.product} onChange={(event) => setSiteDraft({ ...siteDraft, product: event.target.value })} placeholder="Unknown unless entered" /></label>
        <div className="supply-fields"><label>Output quantity<input type="number" min="0" step="any" value={siteDraft.outputQuantity} onChange={(event) => setSiteDraft({ ...siteDraft, outputQuantity: event.target.value })} placeholder="UNKNOWN" /></label><label>Output unit<input maxLength={60} value={siteDraft.outputUnit} onChange={(event) => setSiteDraft({ ...siteDraft, outputUnit: event.target.value })} placeholder="Your documented unit" /></label></div>
        <div className="supply-fields"><label>Electricity use · kWh<input type="number" min="0" step="any" value={siteDraft.energyKwh} onChange={(event) => setSiteDraft({ ...siteDraft, energyKwh: event.target.value })} placeholder="UNKNOWN" /></label><label>Electricity factor · kg CO₂e/kWh<input type="number" min="0" step="any" value={siteDraft.gridKgCo2PerKwh} onChange={(event) => setSiteDraft({ ...siteDraft, gridKgCo2PerKwh: event.target.value })} placeholder="No default factor" /></label></div>
        <label>Process emissions · kg CO₂e<input type="number" min="0" step="any" value={siteDraft.processKgCo2e} onChange={(event) => setSiteDraft({ ...siteDraft, processKgCo2e: event.target.value })} placeholder="UNKNOWN · enter 0 only when supported" /></label>
        <label>Source / factor evidence<textarea maxLength={1000} rows={2} value={siteDraft.source} onChange={(event) => setSiteDraft({ ...siteDraft, source: event.target.value })} placeholder="Source URL or note, factor basis and reporting period" /></label>
        <label>Evidence timestamp · ISO 8601<input maxLength={64} value={siteDraft.evidenceUpdatedAt} onChange={(event) => setSiteDraft({ ...siteDraft, evidenceUpdatedAt: event.target.value })} placeholder="Blank means UNKNOWN" /></label>
        <p className="supply-help">Keep electricity, process emissions and output in the same reporting period. Enter a CO₂e factor if combining gases; a CO₂-only factor covers CO₂ only. Avoid counting electricity again in process emissions.</p>
        <button type="submit" className="supply-primary">{editingSiteId ? 'Save site update' : 'Save site'}</button>
      </form>

      <div className="supply-sites"><div className="supply-subheading"><h3>Facility inspection</h3><span>{network.sites.length} entered</span></div>
        {!network.sites.length && <p className="supply-empty">No facilities added. Start with a selected place or a reviewed facility record. No real factories or production quantities are assumed.</p>}
        {network.sites.length > 0 && <label>Inspect a saved site<select value={selectedSiteId ?? ''} onChange={(event) => { setSelectedSiteId(event.target.value || null); const site = network.sites.find((item) => item.id === event.target.value); if (site) onSelectSite?.(site); }}><option value="">Choose a site</option>{network.sites.map((site) => <option value={site.id} key={site.id}>{site.name}</option>)}</select></label>}
        {inspectedSite && inspected && <article className="supply-inspection"><div className="supply-subheading"><h4>{inspectedSite.name}</h4><span className="supply-estimate">ESTIMATE</span></div><p>{inspectedSite.lat.toFixed(5)}, {inspectedSite.lng.toFixed(5)} · {inspectedSite.product || 'Product UNKNOWN'}</p><dl><div><dt>Output</dt><dd>{display(inspectedSite.outputQuantity)} {inspectedSite.outputUnit || '(unit UNKNOWN)'}</dd></div><div><dt>Electricity emissions</dt><dd>{display(inspected.electricityKgCo2e)} kg CO₂e</dd></div><div><dt>Process emissions</dt><dd>{display(inspected.processKgCo2e)} kg CO₂e</dd></div><div><dt>Entered site estimate</dt><dd>{display(inspected.totalKgCo2e)} kg CO₂e</dd></div><div><dt>Known component subtotal</dt><dd>{display(inspected.knownSubtotalKgCo2e)} kg CO₂e</dd></div><div><dt>Intensity</dt><dd>{display(inspected.intensityKgPerUnit)} {inspectedSite.outputUnit ? `kg CO₂e/${inspectedSite.outputUnit}` : ''}</dd></div></dl>{inspected.unknown.length > 0 && <p className="supply-unknown">UNKNOWN: {inspected.unknown.join(' · ')}</p>}<p><strong>Source:</strong> {inspectedSite.source || 'UNKNOWN'}</p><p><strong>Evidence updated:</strong> {inspectedSite.evidenceUpdatedAt || 'UNKNOWN'}</p><div className="supply-actions"><button type="button" onClick={() => { setEditingSiteId(inspectedSite.id); setSiteDraft(siteForm(inspectedSite)); editingBaseline.current = JSON.stringify(inspectedSite); }}>Edit site</button><button type="button" className="supply-danger" onClick={() => removeSite(inspectedSite)}>Remove site</button></div></article>}
      </div>
    </div>

    <section className="supply-routes"><div className="supply-subheading"><div><h3>Supply route legs</h3><p>Great-circle distance is a geographic approximation. Actual freight routes, detours and return journeys require separate evidence.</p></div></div>
      <form className="supply-route-form" onSubmit={saveLeg}><div className="supply-fields"><label>From site<select required value={legDraft.fromSiteId} onChange={(event) => setLegDraft({ ...legDraft, fromSiteId: event.target.value })}><option value="">Choose origin</option>{network.sites.map((site) => <option value={site.id} key={site.id}>{site.name}</option>)}</select></label><label>To site<select required value={legDraft.toSiteId} onChange={(event) => setLegDraft({ ...legDraft, toSiteId: event.target.value })}><option value="">Choose destination</option>{network.sites.map((site) => <option value={site.id} key={site.id}>{site.name}</option>)}</select></label><label>Freight mass · tonnes<input type="number" min="0" step="any" value={legDraft.massTonnes} onChange={(event) => setLegDraft({ ...legDraft, massTonnes: event.target.value })} placeholder="UNKNOWN" /></label><label>Factor · kg CO₂e/tonne-km<input type="number" min="0" step="any" value={legDraft.transportFactorKgPerTonneKm} onChange={(event) => setLegDraft({ ...legDraft, transportFactorKgPerTonneKm: event.target.value })} placeholder="No default factor" /></label></div><div className="supply-fields"><label>Route source / factor evidence<input maxLength={1000} value={legDraft.source} onChange={(event) => setLegDraft({ ...legDraft, source: event.target.value })} /></label><label>Evidence timestamp · ISO 8601<input maxLength={64} value={legDraft.evidenceUpdatedAt} onChange={(event) => setLegDraft({ ...legDraft, evidenceUpdatedAt: event.target.value })} placeholder="Blank means UNKNOWN" /></label></div><div className="supply-actions"><button type="submit" className="supply-primary" disabled={network.sites.length < 2}>{editingLegId ? 'Save route update' : 'Save route leg'}</button>{editingLegId && <button type="button" onClick={clearLegDraft}>Cancel route edit</button>}</div></form>
      {!network.legs.length && <p className="supply-empty">No route legs. Add two sites, then enter a documented shipment and its own emission factor.</p>}
      <div className="supply-leg-list">{network.legs.map((leg) => { const result = calculateLegFootprint(leg, network.sites); return <article key={leg.id}><div><strong>{network.sites.find((site) => site.id === leg.fromSiteId)?.name} → {network.sites.find((site) => site.id === leg.toSiteId)?.name}</strong><p>{display(result.distanceKm)} km geodesic · {display(leg.massTonnes)} tonnes · {display(result.totalKgCo2e)} kg CO₂e estimated</p>{result.unknown.length > 0 && <p className="supply-unknown">UNKNOWN: {result.unknown.join(' · ')}</p>}<small>Source: {leg.source || 'UNKNOWN'} · evidence {leg.evidenceUpdatedAt || 'UNKNOWN'}</small></div><div className="supply-actions"><button type="button" onClick={() => { setEditingLegId(leg.id); setLegDraft(legForm(leg)); legBaseline.current = JSON.stringify(leg); }}>Edit route</button><button type="button" className="supply-danger" onClick={() => { commit({ ...networkRef.current, legs: networkRef.current.legs.filter((item) => item.id !== leg.id) }, 'Route leg removed.'); if (editingLegId === leg.id) clearLegDraft(); }}>Remove route</button></div></article>; })}</div>
    </section>

    <section className="supply-comparison"><div className="supply-subheading"><div><h3>Compare entered footprints</h3><p>Compare matching products, output units, reporting periods and boundaries. These entries do not establish which supplier is environmentally preferable.</p></div></div><div className="supply-fields"><label>Product / output unit<select value={comparisonGroup} onChange={(event) => setComparisonGroup(event.target.value)}><option value="">All entered sites</option>{groups.map((group) => { const [product, unit] = JSON.parse(group) as string[]; return <option key={group} value={group}>{product || 'Product UNKNOWN'} / {unit || 'unit UNKNOWN'}</option>; })}</select></label><label>Sort entries<select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="name">Name</option><option value="total">Entered emissions · ascending</option><option value="intensity">Per-unit intensity · ascending</option></select></label></div><div className="supply-table-wrap"><table><caption>Estimated electricity plus process footprints; freight shown separately above.</caption><thead><tr><th>Site / product</th><th>Output</th><th>Entered estimate · kg CO₂e</th><th>Known subtotal · kg CO₂e</th><th>Intensity · kg CO₂e/unit</th></tr></thead><tbody>{comparison.map(({ site, footprint }) => <tr key={site.id}><th scope="row"><button type="button" className="supply-link" onClick={() => { setSelectedSiteId(site.id); onSelectSite?.(site); }}>{site.name}</button><small>{site.product || 'Product UNKNOWN'}</small></th><td>{display(site.outputQuantity)} {site.outputUnit || '(unit UNKNOWN)'}</td><td>{display(footprint.totalKgCo2e)}</td><td>{display(footprint.knownSubtotalKgCo2e)}</td><td>{display(footprint.intensityKgPerUnit)}{site.outputUnit ? ` / ${site.outputUnit}` : ''}</td></tr>)}</tbody></table>{!comparison.length && <p className="supply-empty">No sites in this comparison.</p>}</div></section>

    <section className="supply-transfer"><div><h3>Portable network JSON</h3><p>Import previews validated sites and route links before replacing this network. Coordinates, IDs, finite quantities and referenced endpoints are checked.</p></div><label className="supply-file-button">{importBusy ? 'Reading JSON…' : 'Choose network JSON'}<input type="file" accept="application/json,.json" onChange={(event) => { void importJson(event.target.files?.[0]); event.currentTarget.value = ''; }} /></label><button type="button" onClick={exportJson}>Export current network</button>{importCandidate && <div className="supply-import-preview" role="status"><p>{importName} · {importCandidate.sites.length} sites · {importCandidate.legs.length} route legs · entered total {display(calculateNetworkFootprint(importCandidate).totalKgCo2e)} kg CO₂e</p><button type="button" className="supply-primary" onClick={() => { commit(importCandidate, 'Imported network replaced the current session network.'); setImportCandidate(null); clearSiteDraft(); clearLegDraft(); setSelectedSiteId(null); }}>Replace network with reviewed import</button><button type="button" onClick={() => setImportCandidate(null)}>Dismiss import</button></div>}</section>
    <details className="supply-method"><summary>Methods, sources and estimate limits</summary><p>Electricity estimate = entered kWh × entered electricity factor. Site estimate = electricity estimate + entered process kg CO₂e. Freight estimate = entered tonnes × approximated great-circle kilometres × entered kg CO₂e/tonne-km. Intensity = known site estimate ÷ positive output quantity. Blank inputs remain UNKNOWN; an explicit documented zero is retained.</p><p>No emission factors are supplied automatically. Keep factors, gases, units, time periods and organizational boundaries consistent. Network addition can double count overlapping processes or shipments and is an estimate of the entries only. Satellite imagery, facility map tags, weather and air-quality exposure do not measure a facility’s carbon emissions or verify production.</p><p><a href={SUPPLY_METHOD_SOURCES.electricity} target="_blank" rel="noreferrer">GHG Protocol · activity data and emission factors</a> · <a href={SUPPLY_METHOD_SOURCES.freight} target="_blank" rel="noreferrer">New Zealand Ministry for the Environment · tonne-kilometre freight method</a></p></details>
  </section>;
}
