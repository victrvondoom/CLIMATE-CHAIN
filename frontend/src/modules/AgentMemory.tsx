import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createAgentMemory,
  deleteAgentMemory,
  fetchAgentMemory,
  fetchAgentMemoryBackup,
  fetchAgentMemoryBackups,
  fetchAgentMemoryConflicts,
  fetchAgentMemoryIntegrity,
  fetchAgentMemoryRetrievals,
  fetchAgentMemoryExports,
  decryptPortableMemoryBackup,
  encryptPortableMemoryBackup,
  restoreAgentMemoryBackup,
  rotateAgentMemoryKey,
  searchAgentMemory,
  updateAgentMemory,
  type AgentMemoryDraft,
  type AgentMemoryEntry,
  type AgentMemoryExports,
  type AgentMemorySnapshot,
  type MemoryBackupEnvelope,
  type MemoryBackupStatus,
  type EncryptedPortableMemoryBackup,
  type MemoryConflictResult,
  type MemoryCategory,
  type MemoryIntegrity,
  type MemoryRetrievalTrace,
  type MemorySearchResult,
} from '../api';

interface VoiceResult {
  isFinal: boolean;
  0: { transcript: string };
}

interface VoiceEvent {
  resultIndex: number;
  results: ArrayLike<VoiceResult>;
}

interface VoiceRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: VoiceEvent) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

interface VoiceWindow extends Window {
  SpeechRecognition?: new () => VoiceRecognition;
  webkitSpeechRecognition?: new () => VoiceRecognition;
}

const EMPTY_DRAFT: AgentMemoryDraft = {
  title: '',
  rule: '',
  why: '',
  scope: 'global',
  category: 'principle',
  tags: [],
  source: 'typed',
  technicalContext: '',
  originalTranscript: '',
  confidence: null,
  priority: 'normal',
  verificationStatus: 'unknown',
  constraints: [],
  affectedComponents: [],
  relatedFiles: [],
  evidence: [],
  exceptions: [],
  dependencies: [],
  conflictsWith: [],
  supersedes: [],
};

const CATEGORIES: { id: MemoryCategory; label: string; help: string }[] = [
  { id: 'principle', label: 'Principle', help: 'A durable judgment or preference' },
  { id: 'workflow', label: 'Workflow', help: 'A sequence or repeatable way of working' },
  { id: 'boundary', label: 'Boundary', help: 'A constraint, risk, or stop condition' },
];

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function saveDownload(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function parseList(value: string) {
  return value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean).slice(0, 100);
}

function backupCount(backup: MemoryBackupEnvelope) {
  if (!backup.store || typeof backup.store !== 'object' || !('entries' in backup.store) || !Array.isArray(backup.store.entries)) return 0;
  return backup.store.entries.length;
}

export function AgentMemory({ onSnapshot, focusMemoryId }: { onSnapshot: (snapshot: AgentMemorySnapshot | null) => void; focusMemoryId?: string | null }) {
  const [snapshot, setSnapshot] = useState<AgentMemorySnapshot | null>(null);
  const [exports, setExports] = useState<AgentMemoryExports | null>(null);
  const [integrity, setIntegrity] = useState<MemoryIntegrity | null>(null);
  const [conflictState, setConflictState] = useState<MemoryConflictResult | null>(null);
  const [retrievalTrace, setRetrievalTrace] = useState<MemoryRetrievalTrace | null>(null);
  const [backupState, setBackupState] = useState<MemoryBackupStatus | null>(null);
  const [searchResult, setSearchResult] = useState<MemorySearchResult | null>(null);
  const [searchError, setSearchError] = useState('');
  const [searchBusy, setSearchBusy] = useState(false);
  const [projectId, setProjectId] = useState('climate-chain');
  const [backupCandidate, setBackupCandidate] = useState<MemoryBackupEnvelope | null>(null);
  const [backupCandidateName, setBackupCandidateName] = useState('');
  const [inspectionId, setInspectionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [sensitiveReviewed, setSensitiveReviewed] = useState(false);
  const [search, setSearch] = useState('');
  const [showArchive, setShowArchive] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<AgentMemoryDraft>(EMPTY_DRAFT);
  const [transcript, setTranscript] = useState('');
  const [voiceCaptured, setVoiceCaptured] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState('');
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<VoiceRecognition | null>(null);
  const recognitionAvailable = typeof window !== 'undefined' && Boolean((window as VoiceWindow).SpeechRecognition || (window as VoiceWindow).webkitSpeechRecognition);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const [nextSnapshot, nextExports] = await Promise.all([fetchAgentMemory(signal), fetchAgentMemoryExports(projectId, signal)]);
      setSnapshot(nextSnapshot);
      setExports(nextExports);
      setError('');
      setLoading(false);
      onSnapshot(nextSnapshot);
      const [nextIntegrity, nextConflicts, nextTrace, nextBackups] = await Promise.allSettled([
        fetchAgentMemoryIntegrity(signal), fetchAgentMemoryConflicts(signal), fetchAgentMemoryRetrievals(signal), fetchAgentMemoryBackups(signal),
      ]);
      if (nextIntegrity.status === 'fulfilled' && nextIntegrity.value.valid && nextIntegrity.value.complete) setIntegrity(nextIntegrity.value);
      else setIntegrity(null);
      if (nextConflicts.status === 'fulfilled' && nextConflicts.value.complete) setConflictState(nextConflicts.value);
      else setConflictState(null);
      if (nextTrace.status === 'fulfilled' && nextTrace.value.complete) setRetrievalTrace(nextTrace.value);
      else setRetrievalTrace(null);
      if (nextBackups.status === 'fulfilled' && nextBackups.value.complete) setBackupState(nextBackups.value);
      else setBackupState(null);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
      setSnapshot(null);
      setExports(null);
      setError(cause instanceof Error ? cause.message : 'Local memory recall failed.');
      setLoading(false);
      onSnapshot(null);
    }
  }, [onSnapshot, projectId]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => {
      controller.abort();
      recognitionRef.current?.stop();
    };
  }, [load]);

  useEffect(() => {
    const query = search.trim();
    if (!query || showArchive) { setSearchResult(null); setSearchError(''); setSearchBusy(false); return; }
    const controller = new AbortController();
    let current = true;
    setSearchBusy(true);
    const timer = window.setTimeout(() => {
      void searchAgentMemory(query, projectId, controller.signal)
        .then((result) => { if (current) { setSearchResult(result); setSearchError(''); } })
        .catch((cause) => {
          if (!current || (cause instanceof DOMException && cause.name === 'AbortError')) return;
          setSearchResult(null);
          setSearchError(cause instanceof Error ? cause.message : 'Memory search failed.');
        })
        .finally(() => { if (current) setSearchBusy(false); });
    }, 220);
    return () => { current = false; window.clearTimeout(timer); controller.abort(); };
  }, [search, projectId, showArchive]);

  useEffect(() => {
    if (!focusMemoryId) return;
    const entry = snapshot?.entries.find((item) => item.id === focusMemoryId);
    if (!entry) return;
    setSearch('');
    setShowArchive(entry.status === 'archived');
    setInspectionId(entry.id);
    const timer = window.setTimeout(() => document.getElementById(`memory-entry-${entry.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80);
    return () => window.clearTimeout(timer);
  }, [focusMemoryId, snapshot]);

  const records = useMemo(() => {
    const entries = search.trim() && !showArchive ? (searchResult?.entries ?? []) : snapshot?.entries ?? [];
    const query = search.trim().toLocaleLowerCase();
    return entries
      .filter((entry) => showArchive ? entry.status === 'archived' : entry.status === 'active')
      .filter((entry) => !query || showArchive || !searchResult || [entry.title, entry.rule, entry.why, entry.scope, ...entry.tags].join(' ').toLocaleLowerCase().includes(query))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [search, searchResult, showArchive, snapshot]);

  const relationTitles = (ids: string[] = []) => ids.map((id) => {
    const related = snapshot?.entries.find((item) => item.id === id);
    return related ? `${related.title} · ${id.slice(0, 8)}` : id;
  });

  function setDraftField<K extends keyof AgentMemoryDraft>(field: K, value: AgentMemoryDraft[K]) {
    setSensitiveReviewed(false);
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function startVoice() {
    const voiceWindow = window as VoiceWindow;
    const Recognition = voiceWindow.SpeechRecognition || voiceWindow.webkitSpeechRecognition;
    if (!Recognition) {
      setNotice('Voice recognition is not available in this browser. Type or paste the judgment below.');
      return;
    }
    setNotice('Voice capture is a draft. Edit the transcript and judgment, then save it explicitly.');
    setError('');
    const recognition = new Recognition();
    recognition.lang = navigator.language || 'en-US';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      let finalText = '';
      let interimText = '';
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (result.isFinal) finalText += `${result[0].transcript} `;
        else interimText += `${result[0].transcript} `;
      }
      if (finalText.trim()) {
        setVoiceCaptured(true);
        setSensitiveReviewed(false);
        setTranscript((current) => `${current.trim()} ${finalText.trim()}`.trim());
      }
      setInterimTranscript(interimText.trim());
    };
    recognition.onerror = (event) => {
      setListening(false);
      setError(`Voice capture stopped${event.error ? ` (${event.error})` : ''}. Your draft remains editable.`);
    };
    recognition.onend = () => {
      setListening(false);
      setInterimTranscript('');
    };
    recognitionRef.current = recognition;
    try {
      recognition.start();
      setListening(true);
    } catch (cause) {
      setListening(false);
      setError(cause instanceof Error ? cause.message : 'Could not start browser voice capture.');
    }
  }

  function stopVoice() {
    recognitionRef.current?.stop();
    setListening(false);
    setInterimTranscript('');
  }

  function promoteTranscript() {
    const words = transcript.trim();
    if (!words) return;
    setDraft((current) => ({
      ...current,
      title: current.title || words.split(/[.!?\n]/, 1)[0].slice(0, 100) || 'Voice-captured judgment',
      rule: current.rule || words,
      source: voiceCaptured ? 'voice' : 'typed',
      originalTranscript: words,
    }));
    setSensitiveReviewed(false);
    setNotice('Transcript copied into the judgment draft. Review and edit every field before saving.');
  }

  function resetDraft() {
    setDraft(EMPTY_DRAFT);
    setEditingId(null);
    setSensitiveReviewed(false);
  }

  async function saveDraft() {
    if (!sensitiveReviewed) {
      setError('Review the full memory draft for credentials, private keys, personal data, and confidential material before saving.');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (editingId) {
        const current = snapshot?.entries.find((entry) => entry.id === editingId);
        if (!current) throw new Error('This memory was removed. Reload the vault before saving.');
        await updateAgentMemory(current, draft);
        setNotice('Reviewed memory updated in the local sandbox.');
      } else {
        await createAgentMemory(draft);
        setNotice('Reviewed memory saved in the local sandbox and added to MCP recall.');
      }
      resetDraft();
      await load();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Could not save the reviewed memory.';
      setError(message);
      if (message.includes('CLIMATE_CHAIN_MEMORY_UNAVAILABLE')) onSnapshot(null);
    } finally {
      setBusy(false);
    }
  }

  function editRecord(entry: AgentMemoryEntry) {
    setEditingId(entry.id);
    setSensitiveReviewed(false);
    setDraft({
      ...EMPTY_DRAFT, title: entry.title, rule: entry.rule, why: entry.why, scope: entry.scope,
      category: entry.category, tags: entry.tags, source: entry.source,
      technicalContext: entry.technicalContext ?? '', originalTranscript: entry.originalTranscript ?? '',
      confidence: entry.confidence ?? null, priority: entry.priority ?? 'normal', verificationStatus: entry.verificationStatus ?? 'unknown',
      constraints: entry.constraints ?? [], affectedComponents: entry.affectedComponents ?? [], relatedFiles: entry.relatedFiles ?? [],
      evidence: entry.evidence ?? [], exceptions: entry.exceptions ?? [], dependencies: entry.dependencies ?? [],
      conflictsWith: entry.conflictsWith ?? [], supersedes: entry.supersedes ?? [],
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function archiveRecord(entry: AgentMemoryEntry) {
    setBusy(true);
    setError('');
    try {
      await updateAgentMemory(entry, { status: 'archived' });
      setNotice('Memory archived. It is preserved locally and excluded from agent recall.');
      await load();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Could not archive this memory.';
      setError(message);
      if (message.includes('CLIMATE_CHAIN_MEMORY_UNAVAILABLE')) onSnapshot(null);
    } finally {
      setBusy(false);
    }
  }

  async function restoreRecord(entry: AgentMemoryEntry) {
    setBusy(true);
    setError('');
    try {
      await updateAgentMemory(entry, { status: 'active' });
      setNotice('Memory restored to active agent recall.');
      await load();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Could not restore this memory.';
      setError(message);
      if (message.includes('CLIMATE_CHAIN_MEMORY_UNAVAILABLE')) onSnapshot(null);
    } finally {
      setBusy(false);
    }
  }

  async function removeRecord(entry: AgentMemoryEntry) {
    if (!window.confirm(`Permanently remove “${entry.title}” from the local memory sandbox?`)) return;
    setBusy(true);
    setError('');
    try {
      await deleteAgentMemory(entry.id);
      setNotice('Memory permanently removed from the local sandbox.');
      if (editingId === entry.id) resetDraft();
      await load();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Could not remove this memory.';
      setError(message);
      if (message.includes('CLIMATE_CHAIN_MEMORY_UNAVAILABLE')) onSnapshot(null);
    } finally {
      setBusy(false);
    }
  }

  async function copyMcpConfig() {
    if (!exports) return;
    try {
      await navigator.clipboard.writeText(exports.mcpConfigJson);
      setNotice('MCP configuration copied. Add it to each coding agent and restart that agent session.');
    } catch {
      setNotice('Clipboard access is unavailable here. Download the MCP JSON configuration instead.');
    }
  }

  async function downloadBackup() {
    const passphrase = window.prompt('Create a separate passphrase (12+ characters) for this encrypted backup. It is never sent to the gateway. Store it separately; it cannot be recovered.');
    if (passphrase === null) { setNotice('Backup cancelled. No file was created.'); return; }
    if (passphrase.length < 12) { setError('Portable backup passphrase must contain at least 12 characters.'); return; }
    if (window.prompt('Re-enter the backup passphrase to confirm it.') !== passphrase) { setNotice('Backup cancelled because the passphrases did not match.'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      const backup = await fetchAgentMemoryBackup();
      const encrypted = await encryptPortableMemoryBackup(backup, passphrase);
      saveDownload(`climate-chain-memory-backup-${new Date().toISOString().slice(0, 10)}.encrypted.json`, JSON.stringify(encrypted, null, 2), 'application/json');
      setNotice(`Encrypted schema v${backup.formatVersion} backup downloaded with ${backup.store && typeof backup.store === 'object' && 'entries' in backup.store && Array.isArray(backup.store.entries) ? backup.store.entries.length : 0} records. Keep its passphrase separately.`);
      const nextBackups = await fetchAgentMemoryBackups(); setBackupState(nextBackups);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create a memory backup.');
    } finally { setBusy(false); }
  }

  async function prepareBackupRestore(file?: File) {
    if (!file) return;
    setError(''); setNotice('');
    try {
      if (file.size > 48 * 1024 * 1024) throw new Error('Memory backup import is limited to 48 MB.');
      let candidate: unknown = JSON.parse(await file.text());
      if (candidate && typeof candidate === 'object' && 'format' in candidate && candidate.format === 'climate-chain-encrypted-memory-backup') {
        const passphrase = window.prompt('Enter the separate passphrase for this encrypted memory backup. The passphrase is processed only in this browser.');
        if (passphrase === null) { setNotice('Backup import cancelled. The local vault was not changed.'); return; }
        candidate = await decryptPortableMemoryBackup(candidate as EncryptedPortableMemoryBackup, passphrase);
      }
      if (!candidate || typeof candidate !== 'object' || !('format' in candidate) || !('integritySha256' in candidate)) throw new Error('Choose a Climate Chain memory backup JSON file.');
      setBackupCandidate(candidate as MemoryBackupEnvelope);
      setBackupCandidateName(file.name);
      setNotice('Backup parsed. Review the replacement warning and confirm explicitly before restoring.');
    } catch (cause) {
      setBackupCandidate(null); setBackupCandidateName('');
      setError(cause instanceof Error ? cause.message : 'Could not read this backup file.');
    }
  }

  async function restoreBackup() {
    if (!backupCandidate) return;
    const confirmation = window.prompt('This replaces the current local vault after taking a safety backup. Type REPLACE_LOCAL_MEMORY to continue.');
    if (confirmation !== 'REPLACE_LOCAL_MEMORY') { setNotice('Restore cancelled. The current vault was not replaced.'); return; }
    const safetyPassphrase = window.prompt('Create a separate passphrase (12+ characters) for the encrypted pre-restore safety copy.');
    if (safetyPassphrase === null) { setNotice('Restore cancelled before any vault changes.'); return; }
    if (safetyPassphrase.length < 12 || window.prompt('Re-enter the safety-copy passphrase to confirm it.') !== safetyPassphrase) { setNotice('Restore cancelled because the safety-copy passphrase was too short or did not match.'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      const current = await fetchAgentMemoryBackup();
      const encryptedCurrent = await encryptPortableMemoryBackup(current, safetyPassphrase);
      saveDownload(`climate-chain-memory-before-restore-${new Date().toISOString().slice(0, 10)}.encrypted.json`, JSON.stringify(encryptedCurrent, null, 2), 'application/json');
      const result = await restoreAgentMemoryBackup(backupCandidate, confirmation);
      setBackupCandidate(null); setBackupCandidateName('');
      setNotice(`Vault restored from reviewed backup: ${result.count} records. A safety copy of the previous vault was downloaded.`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not restore this backup. The vault was not reported as restored.');
    } finally { setBusy(false); }
  }

  async function rotateVaultKey() {
    const confirmation = window.prompt('This creates a new Windows DPAPI vault key and re-encrypts the active vault. Older keys remain to recover existing backups. Type ROTATE_MEMORY_KEY to continue.');
    if (confirmation !== 'ROTATE_MEMORY_KEY') { setNotice('Key rotation cancelled.'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await rotateAgentMemoryKey(confirmation);
      setNotice(`Vault key rotated to ${result.keyId.slice(0, 12)}. ${result.retainedKeyVersions} protected key versions remain for recovery.`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Vault key rotation failed; current memory remains available.');
    } finally { setBusy(false); }
  }

  const graphEntries = [...(snapshot?.entries ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 12);
  const graphPositions = new Map(graphEntries.map((entry, index) => [entry.id, { x: 100 + (index % 4) * 200, y: 40 + Math.floor(index / 4) * 90 }]));
  const graphEdges = graphEntries.flatMap((entry) => ([
    ...(entry.dependencies ?? []).map((id) => ({ id, kind: 'dependency' as const })),
    ...(entry.conflictsWith ?? []).map((id) => ({ id, kind: 'conflict' as const })),
    ...(entry.supersedes ?? []).map((id) => ({ id, kind: 'supersedes' as const })),
  ]).flatMap((relation) => {
    const from = graphPositions.get(entry.id);
    const to = graphPositions.get(relation.id);
    return from && to ? [{ key: `${entry.id}-${relation.kind}-${relation.id}`, from, to, kind: relation.kind }] : [];
  }));
  const graphHeight = Math.max(90, Math.ceil(graphEntries.length / 4) * 90);

  function inspectGraphEntry(entry: AgentMemoryEntry) {
    setSearch('');
    setShowArchive(entry.status === 'archived');
    setInspectionId(entry.id);
    window.setTimeout(() => document.getElementById(`memory-entry-${entry.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80);
  }

  return (
    <div className="stack agent-memory-page">
      <section className="memory-hero">
        <div className="memory-hero-copy">
          <div className="eyebrow">LOCAL ENGINEERING MEMORY · HUMAN-TAUGHT, AGENT-RECALLED</div>
          <h2>Teach once.<br /><span>Recall before every change.</span></h2>
          <p>Dictate the judgment hidden between the lines. Review it, save it into a separate local sandbox, then carry the rules and MCP bridge into your coding agents.</p>
          <div className="memory-hero-chips"><span>Voice → reviewed draft</span><span>Isolated local vault</span><span>Read-only MCP recall</span></div>
        </div>
        <div className="memory-orbit" aria-hidden="true">
          <div className="memory-orbit-ring memory-orbit-ring-a" />
          <div className="memory-orbit-ring memory-orbit-ring-b" />
          <div className="memory-orbit-core"><span>JUDGMENT</span><strong>↻</strong><span>RECALLED</span></div>
          <i className="memory-orbit-node memory-orbit-node-a" />
          <i className="memory-orbit-node memory-orbit-node-b" />
          <i className="memory-orbit-node memory-orbit-node-c" />
        </div>
      </section>

      {error && <div className="memory-error" role="alert"><strong>Recall gate is closed.</strong><span>{error}</span><span>Agent work must stop until the local memory vault is available and complete.</span><button type="button" className="memory-button" onClick={() => void load()}>Retry vault</button></div>}
      {notice && <div className="memory-notice" role="status">{notice}</div>}

      <section className="memory-stat-row" aria-label="Memory system status">
        <div className="memory-stat"><span className="memory-stat-icon">{snapshot?.complete ? '✓' : '!'}</span><div><small>RECALL GATE</small><strong>{snapshot?.complete ? 'Complete' : loading ? 'Checking' : 'Closed'}</strong></div></div>
        <div className="memory-stat"><span className="memory-stat-icon">{snapshot?.activeCount ?? '—'}</span><div><small>ACTIVE JUDGMENTS</small><strong>{snapshot ? 'Available to MCP' : loading ? 'Scanning local vault' : 'Awaiting local vault'}</strong></div></div>
        <div className="memory-stat"><span className="memory-stat-icon">⌂</span><div><small>STORAGE BOUNDARY</small><strong>Private user sandbox</strong></div></div>
      </section>

      <section className="memory-health-panel" aria-label="Memory health dashboard">
        <div className="memory-health-heading"><div><span className="eyebrow">VAULT HEALTH · PROJECT-SCOPED RECALL</span><h2>Memory readiness</h2></div><div className="memory-project-picker"><label htmlFor="memory-project-id">Active project ID</label><input id="memory-project-id" value={projectId} maxLength={100} onChange={(event) => setProjectId(event.target.value)} placeholder="project name or ID" /></div></div>
        <div className="memory-health-metrics">
          <div><small>INTEGRITY</small><strong>{integrity?.valid ? `Verified · schema v${integrity.schemaVersion}` : 'Unavailable or checking'}</strong></div>
          <div><small>ACTIVE / EFFECTIVE</small><strong>{snapshot ? `${snapshot.activeCount} / ${snapshot.effectiveActiveCount ?? snapshot.activeCount}` : '—'}</strong></div>
          <div><small>DECLARED CONFLICTS</small><strong>{conflictState ? `${conflictState.conflicts.length} linked` : 'Unavailable'}</strong></div>
          <div><small>LAST RETRIEVAL LATENCY</small><strong>{retrievalTrace?.events[0] ? `${retrievalTrace.events[0].durationMs} ms · ${retrievalTrace.events[0].operation}` : 'No retrieval trace'}</strong></div>
          <div><small>LATEST BACKUP</small><strong>{backupState?.latest ? `${formatDate(backupState.latest.createdAt)} · ${backupState.latest.integrityValid ? 'verified' : 'corrupt'}` : 'No backup found'}</strong></div>
          <div><small>CONNECTED AGENTS</small><strong>Not observable · local stdio MCP</strong></div>
        </div>
        <div className="memory-encryption-status" role="status">
          <div><small>AT-REST ENCRYPTION</small><strong>{snapshot?.encryption?.activePlaintextVault ? 'Active vault is plaintext' : snapshot?.encryption?.enabled ? `${snapshot.encryption.algorithm} · ${snapshot.encryption.keyProtection}` : 'Disabled on this storage provider'}</strong></div>
          {snapshot?.encryption?.warning ? <p role="alert">{snapshot.encryption.warning}</p> : <p>{snapshot?.encryption?.enabled ? 'Vault and automatic recovery copies use authenticated encryption. Key material is not stored as plaintext beside the vault.' : 'Set up a supported local key provider before saving sensitive decisions.'}</p>}
          {snapshot?.encryption?.keyProtection === 'Windows DPAPI CurrentUser' && <button type="button" className="memory-button memory-button-quiet" disabled={busy || !snapshot.complete} onClick={() => void rotateVaultKey()}>Rotate vault key</button>}
        </div>
        {conflictState?.conflicts.length ? <div className="memory-conflict-panel"><strong>Conflicting decisions need explicit review</strong>{conflictState.conflicts.map((conflict) => <div key={conflict.id}>{conflict.records.map((entry) => entry.title).join(' ↔ ')} <small> · {conflict.id.slice(0, 18)}</small></div>)}</div> : null}
        <p className="muted small">Retrieval audit: {snapshot?.encryption?.auditEncryptedAtRest ? 'AES-256-GCM encrypted at rest.' : snapshot?.encryption?.plaintextAuditPresent && snapshot.encryption.enabled ? 'Plaintext legacy JSONL pending encrypted migration.' : 'Plaintext local JSONL because vault encryption is disabled.'}</p>
        <details className="memory-trace-panel"><summary>Inspect retrieval history and why memories were returned</summary>
          {retrievalTrace?.events.length ? <div className="memory-trace-list">{retrievalTrace.events.map((item) => <article key={item.id}><time dateTime={item.at}>{formatDate(item.at)}</time><strong>{item.operation} · {item.project}</strong><span>{item.returned.length} records · {item.durationMs} ms · query hash {item.querySha256?.slice(0, 14) ?? 'none'}</span><small>{item.returned.flatMap((record) => record.reasons.map((reason) => `${record.id.slice(0, 8)}: ${reason}`)).join(' · ') || 'No records matched.'}</small></article>)}</div> : <p className="muted small">No retrieval calls have been traced yet. Search through MCP to create a trace without saving raw query text.</p>}
        </details>
      </section>

      <section className="memory-graph-panel" aria-label="Judgment memory graph">
        <div className="memory-graph-heading"><div><span className="eyebrow">CONNECTED JUDGMENTS</span><h2>Decision graph</h2><p>Declared dependencies, conflicts, and superseding decisions connect the reasoning behind each rule.</p></div><span>{graphEntries.length} visible nodes · up to 12</span></div>
        {graphEntries.length ? <div className="memory-graph-scroll"><div className="memory-graph-map" style={{ height: graphHeight }}>
          <svg className="memory-graph-edges" viewBox={`0 0 800 ${graphHeight}`} role="img" aria-label={`${graphEdges.length} declared decision links`}>
            {graphEdges.map((edge) => <line key={edge.key} x1={edge.from.x} y1={edge.from.y} x2={edge.to.x} y2={edge.to.y} className={`memory-edge memory-edge-${edge.kind}`} />)}
          </svg>
          <div className="memory-graph-nodes">{graphEntries.map((entry) => <button type="button" className={`memory-graph-node ${entry.status === 'archived' ? 'archived' : ''}`} key={entry.id} onClick={() => inspectGraphEntry(entry)} aria-label={`Inspect decision ${entry.title}`}>
            <span>{entry.category} · {entry.scope} · {entry.status}</span><strong>{entry.title}</strong><small>{(entry.dependencies?.length ?? 0) + (entry.conflictsWith?.length ?? 0) + (entry.supersedes?.length ?? 0)} declared links</small>
          </button>)}</div>
        </div></div> : <div className="memory-graph-empty"><span className="memory-graph-empty-orbit" aria-hidden="true">◇</span><strong>No decisions are connected yet</strong><p>Save reviewed judgments, then link their dependencies, evidence, exceptions, conflicts, and superseding rules.</p></div>}
        <div className="memory-graph-legend"><span><i className="memory-edge-swatch dependency" /> Depends on</span><span><i className="memory-edge-swatch conflict" /> Declared conflict</span><span><i className="memory-edge-swatch supersedes" /> Supersedes</span></div>
      </section>

      <div className="memory-workbench">
        <section className="card memory-card memory-capture-card">
          <div className="memory-card-heading"><div><span className="eyebrow">01 / CAPTURE · REVIEW · SAVE</span><h2>{editingId ? 'Refine a judgment' : 'Teach your agent what only you know'}</h2></div><span className="memory-step-mark">A</span></div>

          <div className="voice-capture-bar">
            <div className="voice-capture-state"><span className={listening ? 'voice-indicator listening' : 'voice-indicator'} />
              <div><strong>{listening ? 'Listening to your judgment' : 'Voice capture is ready'}</strong><small>{recognitionAvailable ? 'Browser speech recognition · no app audio upload' : 'Voice recognition unavailable · type or paste instead'}</small></div>
            </div>
            {listening
              ? <button type="button" className="memory-button memory-button-recording" onClick={stopVoice}>Stop capture</button>
              : <button type="button" className="memory-button memory-button-primary" onClick={startVoice} disabled={!recognitionAvailable}>◉ &nbsp; Dictate</button>}
          </div>

          <label className="memory-field memory-transcript-field"><span>VOICE TRANSCRIPT <small>Editable · not saved until you choose</small></span>
            <textarea value={transcript} onChange={(event) => setTranscript(event.target.value)} placeholder="Speak the design trade-off, correction, or hard-won rule your agent could not infer…" rows={3} />
          </label>
          {interimTranscript && <div className="voice-interim">{interimTranscript}</div>}
          <div className="memory-capture-actions"><div><button type="button" className="memory-button memory-button-quiet" onClick={promoteTranscript} disabled={!transcript.trim()}>Use transcript in review draft →</button><button type="button" className="memory-text-button" onClick={() => { setTranscript(''); setVoiceCaptured(false); setInterimTranscript(''); }}>Clear transcript</button></div><span>Dictation behavior can vary by browser. Review the transcript for accuracy.</span></div>

          <div className="memory-form-divider"><span>TURN IT INTO REUSABLE JUDGMENT</span><i /></div>
          <label className="memory-field"><span>SHORT TITLE</span><input value={draft.title} maxLength={120} onChange={(event) => setDraftField('title', event.target.value)} placeholder="e.g. Preserve the source project boundary" /></label>
          <div className="memory-field-row">
            <label className="memory-field"><span>MEMORY KIND</span><select value={draft.category} onChange={(event) => setDraftField('category', event.target.value as MemoryCategory)}>{CATEGORIES.map((item) => <option key={item.id} value={item.id}>{item.label} — {item.help}</option>)}</select></label>
            <label className="memory-field"><span>NAMESPACE <small>global or a project ID</small></span><input value={draft.scope} maxLength={100} onChange={(event) => setDraftField('scope', event.target.value)} placeholder="global or climate-chain" /></label>
          </div>
          <label className="memory-field"><span>THE JUDGMENT <small>What should the coding agent do?</small></span><textarea value={draft.rule} maxLength={2400} onChange={(event) => setDraftField('rule', event.target.value)} placeholder="State the instruction clearly enough to follow before making a change…" rows={4} /></label>
          <label className="memory-field"><span>WHY IT MATTERS <small>Optional context that helps apply the rule</small></span><textarea value={draft.why} maxLength={1200} onChange={(event) => setDraftField('why', event.target.value)} placeholder="What mistake, risk, or project choice led to this guidance?" rows={2} /></label>
          <label className="memory-field"><span>TAGS <small>Optional · comma separated</small></span><input value={draft.tags.join(', ')} onChange={(event) => setDraftField('tags', event.target.value.split(',').map((tag) => tag.trim()).filter(Boolean).slice(0, 8))} placeholder="architecture, safety, review" /></label>
          <details className="memory-graph-editor"><summary>Judgment graph · technical context, evidence, components and relations</summary>
            <label className="memory-field"><span>TECHNICAL CONTEXT</span><textarea value={draft.technicalContext ?? ''} onChange={(event) => setDraftField('technicalContext', event.target.value)} rows={3} placeholder="Relevant behavior or technical background" /></label>
            <label className="memory-field"><span>ORIGINAL TRANSCRIPT <small>Kept separately from the reviewed instruction</small></span><textarea value={draft.originalTranscript ?? ''} onChange={(event) => setDraftField('originalTranscript', event.target.value)} rows={2} placeholder="Original voice wording" /></label>
            <div className="memory-field-row"><label className="memory-field"><span>CONFIDENCE · 0 TO 1</span><input type="number" min="0" max="1" step="0.05" value={draft.confidence ?? ''} onChange={(event) => setDraftField('confidence', event.target.value === '' ? null : Number(event.target.value))} /></label><label className="memory-field"><span>PRIORITY AND VERIFICATION</span><div className="memory-field-selects"><select value={draft.priority ?? 'normal'} onChange={(event) => setDraftField('priority', event.target.value as NonNullable<AgentMemoryDraft['priority']>)}><option value="low">Low priority</option><option value="normal">Normal priority</option><option value="high">High priority</option><option value="critical">Critical priority</option></select><select value={draft.verificationStatus ?? 'unknown'} onChange={(event) => setDraftField('verificationStatus', event.target.value as NonNullable<AgentMemoryDraft['verificationStatus']>)}><option value="unknown">Verification unknown</option><option value="unverified">Unverified</option><option value="verified">Verified</option></select></div></label></div>
            {([
              ['constraints', 'CONSTRAINTS'], ['affectedComponents', 'AFFECTED COMPONENTS'], ['relatedFiles', 'RELATED FILES'], ['evidence', 'EVIDENCE'], ['exceptions', 'EXCEPTIONS'],
              ['dependencies', 'DECISION DEPENDENCIES · RECORD IDS'], ['conflictsWith', 'CONFLICTING DECISIONS · RECORD IDS'], ['supersedes', 'SUPERSEDES · RECORD IDS'],
            ] as const).map(([field, label]) => <label className="memory-field" key={field}><span>{label} <small>One per line or comma separated</small></span><textarea value={(draft[field] ?? []).join('\n')} onChange={(event) => setDraftField(field, parseList(event.target.value))} rows={field === 'constraints' || field === 'evidence' ? 2 : 1} /></label>)}
          </details>
          <div className="memory-sensitive-warning"><strong>Privacy check before saving</strong><span>{snapshot?.encryption?.enabled ? 'The unsaved draft is visible in this browser; after approval, the local vault encrypts it at rest.' : 'This local vault is not encrypted on the current storage provider.'} Remove passwords, access tokens, private keys, personal data, and confidential evidence. Browser speech recognition may use an external service; review the transcript before copying it into memory.</span><label><input type="checkbox" checked={sensitiveReviewed} onChange={(event) => setSensitiveReviewed(event.target.checked)} /> I reviewed the full draft and removed sensitive material.</label></div>
          <div className="memory-form-footer"><span>{draft.source === 'voice' ? 'Origin: reviewed voice draft' : 'Origin: typed judgment'} · explicit review is required</span><div>{editingId && <button type="button" className="memory-button memory-button-quiet" onClick={resetDraft}>Cancel edit</button>}<button type="button" className="memory-button memory-button-primary" onClick={() => void saveDraft()} disabled={busy || !snapshot?.complete || !draft.title.trim() || !draft.rule.trim() || !sensitiveReviewed}>{busy ? 'Saving…' : editingId ? 'Save reviewed update' : 'Save to local memory'}</button></div></div>
        </section>

        <section className="card memory-card memory-vault-card">
          <div className="memory-card-heading"><div><span className="eyebrow">02 / RECALLABLE MEMORY</span><h2>The local judgment ledger</h2></div><span className="memory-step-mark">B</span></div>
          <div className="vault-integrity-banner" data-ready={snapshot?.complete ? 'true' : 'false'}>
            <span className="vault-seal">{snapshot?.complete ? '✓' : '!'}</span>
            <div><strong>{snapshot?.complete ? 'Complete scan · integrity verified' : 'No complete vault scan'}</strong><small>{snapshot ? `${snapshot.activeCount} active of ${snapshot.count} saved · SHA-256 ${snapshot.manifestSha256.slice(0, 16)}…` : 'The system will not claim memory was recalled.'}</small></div>
          </div>
          <div className="memory-filter-row"><label className="memory-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a saved judgment" /></label><button type="button" className={'memory-filter-button' + (!showArchive ? ' active' : '')} onClick={() => setShowArchive(false)}>Active {snapshot?.activeCount ?? 0}</button><button type="button" className={'memory-filter-button' + (showArchive ? ' active' : '')} onClick={() => setShowArchive(true)}>Archived {snapshot?.count ? snapshot.count - snapshot.activeCount : 0}</button></div>

          {searchBusy && <p className="memory-search-status" role="status">Searching active judgments in global + {projectId} and recording a privacy-safe retrieval trace…</p>}
          {searchError && <p className="memory-search-error" role="alert">{searchError}</p>}
          {searchResult && <p className="memory-search-status" role="status">{records.length} returned of {searchResult.totalVisible} visible memories · lexical + graph matches · {searchResult.trace.durationMs} ms. The raw query is not stored in the retrieval audit.</p>}
          <div className="memory-record-list">
            {records.map((entry) => <article className="memory-record" id={`memory-entry-${entry.id}`} key={entry.id}>
              <div className="memory-record-top"><div><span className={`memory-kind memory-kind-${entry.category}`}>{entry.category}</span><span className="memory-scope">{entry.scope}</span></div><time dateTime={entry.updatedAt}>{formatDate(entry.updatedAt)}</time></div>
              <h3>{entry.title}</h3><p className="memory-rule-text">{entry.rule}</p>{entry.why && <p className="memory-why"><strong>Why:</strong> {entry.why}</p>}
              <details className="memory-record-graph" open={inspectionId === entry.id} onToggle={(event) => setInspectionId(event.currentTarget.open ? entry.id : null)}><summary>Inspect decision graph · revision {entry.revision ?? 1}</summary>
                <div className="memory-graph-columns">
                  <div><small>TECHNICAL CONTEXT</small><p>{entry.technicalContext || 'No technical context recorded.'}</p><small>CONSTRAINTS</small><p>{entry.constraints?.join(' · ') || 'None recorded.'}</p><small>AFFECTED COMPONENTS</small><p>{entry.affectedComponents?.join(' · ') || 'None recorded.'}</p><small>RELATED FILES</small><p>{entry.relatedFiles?.join(' · ') || 'None recorded.'}</p></div>
                  <div><small>EVIDENCE</small><p>{entry.evidence?.join(' · ') || 'None recorded.'}</p><small>EXCEPTIONS</small><p>{entry.exceptions?.join(' · ') || 'None recorded.'}</p><small>DEPENDS ON</small><p>{relationTitles(entry.dependencies).join(' · ') || 'No linked decision.'}</p><small>CONFLICTS WITH</small><p>{relationTitles(entry.conflictsWith).join(' · ') || 'No declared conflict.'}</p><small>SUPERSEDES</small><p>{relationTitles(entry.supersedes).join(' · ') || 'No superseded decision.'}</p></div>
                </div>
                {(() => {
                  const lastRetrieval = searchResult?.trace.returned.some((record) => record.id === entry.id)
                    ? searchResult.trace
                    : retrievalTrace?.events.find((event) => event.returned.some((record) => record.id === entry.id));
                  return <p className="memory-retrieval-reason"><strong>Last successful retrieval:</strong> {lastRetrieval ? `${formatDate(lastRetrieval.at)} · ${lastRetrieval.operation} · ${lastRetrieval.project}` : 'No successful retrieval recorded yet.'}</p>;
                })()}
                <p className="memory-retrieval-reason"><strong>Why retrieved:</strong> {searchResult?.scores.find((score) => score.id === entry.id)?.reasons.join(' · ') || 'This record is shown from the complete vault list; no search match was used.'}</p>
                <p className="memory-retrieval-reason"><strong>Confidence:</strong> {entry.confidence == null ? 'not specified' : `${Math.round(entry.confidence * 100)}%`} · <strong>Priority:</strong> {entry.priority ?? 'normal'} · <strong>Verification:</strong> {entry.verificationStatus ?? 'unknown'} · <strong>Versions retained:</strong> {entry.versions?.length ?? 0}</p>
              </details>
              <div className="memory-record-bottom"><span>{entry.source === 'voice' ? '◉ Voice reviewed' : '✎ Typed'} · {entry.digest.slice(0, 10)}</span><div>{showArchive ? <button type="button" className="memory-text-button" onClick={() => void restoreRecord(entry)} disabled={busy}>Restore</button> : <><button type="button" className="memory-text-button" onClick={() => editRecord(entry)}>Edit</button><button type="button" className="memory-text-button" onClick={() => void archiveRecord(entry)} disabled={busy}>Archive</button></>}<button type="button" className="memory-text-button memory-delete-button" onClick={() => void removeRecord(entry)} disabled={busy}>Delete</button></div></div>
            </article>)}
            {!records.length && <div className="memory-empty"><span>◇</span><strong>{loading ? 'Loading complete local recall' : search ? 'No matching judgment' : showArchive ? 'Nothing archived' : 'Your ledger is ready'}</strong><p>{loading ? 'The vault is being checked before the saved memory list is shown.' : search ? 'Try a different title, rule, scope, or tag.' : 'Capture one decision that you usually have to teach an agent more than once.'}</p></div>}
          </div>
        </section>
      </div>

      <section className="card memory-export-card">
        <div className="memory-export-head"><div><span className="eyebrow">03 / MAKE MEMORY HARD TO MISS</span><h2>Install the recall gate in your coding agent</h2><p>Export project rules and connect MCP. The same local vault feeds both; the bridge only reads, and edits always return here for your review.</p></div><span className="memory-step-mark">C</span></div>
        <div className="memory-export-actions">
          <button type="button" className="memory-button memory-button-primary" disabled={!exports || !snapshot?.complete} onClick={() => exports && saveDownload('AGENTS.md', exports.markdown, 'text/markdown')}>↓ &nbsp; Download AGENTS.md · Codex</button>
          <button type="button" className="memory-button memory-button-quiet" disabled={!exports || !snapshot?.complete} onClick={() => exports && saveDownload('CLAUDE.md', exports.claudeMarkdown, 'text/markdown')}>↓ &nbsp; Download CLAUDE.md</button>
          <button type="button" className="memory-button memory-button-quiet" disabled={!exports || !snapshot?.complete} onClick={() => exports && saveDownload('climate-chain-memory.mcp.json', exports.mcpConfigJson, 'application/json')}>↓ &nbsp; Download MCP setup</button>
          <button type="button" className="memory-button memory-button-quiet" disabled={!exports || !snapshot?.complete} onClick={() => void copyMcpConfig()}>Copy MCP JSON</button>
          <button type="button" className="memory-button memory-button-quiet" onClick={() => void load()}>Refresh recall</button>
        </div>
        <section className="memory-backup-controls" aria-label="Memory backup and restore">
          <div className="memory-backup-head"><div><strong>Portable vault backup</strong><p>Portable backups use browser-local AES-256-GCM with a separate passphrase. The passphrase is never sent to this gateway and cannot be recovered; keep it separately from the file. Legacy plaintext backups can still be imported.</p></div><button type="button" className="memory-button memory-button-primary" disabled={!snapshot?.complete || busy} onClick={() => void downloadBackup()}>{busy ? 'Working…' : 'Download encrypted backup'}</button></div>
          <div className="memory-backup-actions"><label className="memory-button memory-button-quiet memory-file-button">Choose backup JSON<input type="file" accept="application/json,.json" onChange={(event) => { void prepareBackupRestore(event.target.files?.[0]); event.currentTarget.value = ''; }} /></label>{backupCandidate && <><span className="memory-backup-candidate">Preview: {backupCandidateName} · schema v{backupCandidate.formatVersion} · {backupCount(backupCandidate)} records · exported {backupCandidate.exportedAt || 'timestamp unavailable'}</span><button type="button" className="memory-button memory-button-primary" disabled={busy || !snapshot?.complete} onClick={() => void restoreBackup()}>Review and restore…</button><button type="button" className="memory-text-button" onClick={() => { setBackupCandidate(null); setBackupCandidateName(''); setNotice('Backup preview dismissed.'); }}>Cancel</button></>}</div>
          {backupState?.backups.length ? <details className="memory-backup-list"><summary>Automatic recovery copies · {backupState.backups.length}</summary>{backupState.backups.slice(0, 5).map((backup) => <div key={backup.name}><code>{backup.name}</code><span>{formatDate(backup.createdAt)} · {Math.ceil(backup.sizeBytes / 1024)} KB · {backup.integrityValid ? 'verified' : 'integrity failed'}</span></div>)}</details> : <p className="memory-backup-empty">No automatic recovery backup is recorded yet. Pre-write copies are created before updates and deletions once the vault contains a record.</p>}
        </section>
        <div className="memory-export-grid">
          <div><small>LOCAL SANDBOX DIRECTORY</small><code>{snapshot?.location ?? 'Unavailable until the local gateway responds'}</code></div>
          <div><small>MANDATORY FAILURE SIGNAL</small><code>CLIMATE_CHAIN_MEMORY_UNAVAILABLE</code></div>
          <div><small>HOW TO CONNECT</small><span>Install the JSON in the agent’s MCP configuration, install AGENTS.md in its project rules, then restart and ask it to report the loaded manifest hash.</span></div>
          <div><small>WHAT THIS CAN ENFORCE</small><span>This app exposes the stop condition and complete local recall. An external agent must load the exported rules; no local app can force an unconfigured client to obey them.</span></div>
        </div>
        {exports && <details className="memory-config-preview"><summary>Inspect the current MCP configuration</summary><pre>{exports.mcpConfigJson}</pre></details>}
      </section>
      <p className="memory-privacy-note">Memory stays in the local user data folder, outside climate evidence and project source data. {snapshot?.encryption?.enabled ? `The active vault uses ${snapshot.encryption.algorithm} with ${snapshot.encryption.keyProtection}; review the plaintext migration notice above if an original copy remains.` : 'This platform does not report at-rest encryption as enabled; avoid saving sensitive material until a supported key provider is configured.'} Review every field before saving. Browser voice recognition may process audio using the browser vendor or its configured service; no audio is sent to this app’s gateway. Only the text you explicitly review and save enters the vault.</p>
    </div>
  );
}
