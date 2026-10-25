// Voice control for the Causal Lab. Recognition is the browser's Web Speech
// API; this module only turns a transcript into a typed, validated command.

export type LabView = 'overview' | 'earth' | 'timeline' | 'ledger' | 'integrity' | 'mission' | 'lab';
export type VoiceCommand =
  | { type: 'goto'; view: LabView }
  | { type: 'set'; key: 'fossilCo2ChangePct' | 'methaneChangePct' | 'horizonYears' | 'sensitivity'; value: number }
  | { type: 'preset'; id: 'net-zero' | 'business-as-usual' | 'high-emissions' | 'el-nino' | 'la-nina' | 'reset' }
  | { type: 'speak' }
  | { type: 'unknown'; heard: string };

const VIEWS: [RegExp, LabView][] = [
  [/\b(timeline|history|historical)\b/, 'timeline'],
  [/\b(globe|earth|satellite|map|weather)\b/, 'earth'],
  [/\b(ledger|blockchain|chain|evidence)\b/, 'ledger'],
  [/\b(integrity|firewall)\b/, 'integrity'],
  [/\bmission\b/, 'mission'],
  [/\b(lab|scenario|causal)\b/, 'lab'],
  [/\b(home|overview|command)\b/, 'overview'],
];
const NUMBER_WORDS: Record<string, number> = { zero: 0, ten: 10, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100 };

function numberIn(raw: string): number | null {
  const text = raw.replace(/\b(co2|ch4|n2o|h2o)\b/g, ' '); // formula digits are not quantities
  const digits = /(-?\d+(?:\.\d+)?)/.exec(text);
  if (digits) return Number(digits[1]);
  for (const [word, value] of Object.entries(NUMBER_WORDS)) if (new RegExp(`\\b${word}\\b`).test(text)) return value;
  return null;
}
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function parseVoiceCommand(raw: string): VoiceCommand {
  const text = raw.toLowerCase().replace(/[.,!?]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return { type: 'unknown', heard: raw };
  if (/\b(read|speak|explain|summar(?:y|ise|ize))\b/.test(text)) return { type: 'speak' };
  if (/\bnet zero\b/.test(text)) return { type: 'preset', id: 'net-zero' };
  if (/\b(business as usual|current policies)\b/.test(text)) return { type: 'preset', id: 'business-as-usual' };
  if (/\b(high emissions|worst case)\b/.test(text)) return { type: 'preset', id: 'high-emissions' };
  if (/\bel ni(?:n|ñ)o\b/.test(text)) return { type: 'preset', id: 'el-nino' };
  if (/\bla ni(?:n|ñ)a\b/.test(text)) return { type: 'preset', id: 'la-nina' };
  if (/\breset\b/.test(text)) return { type: 'preset', id: 'reset' };

  const n = numberIn(text);
  const down = /\b(cut|reduce|lower|down|minus|decrease|drop)\b/.test(text);
  const sign = down ? -1 : 1;
  if (n !== null) {
    if (/\b(methane|ch4)\b/.test(text)) return { type: 'set', key: 'methaneChangePct', value: clamp(sign * Math.abs(n), -100, 60) };
    if (/\b(carbon|co2|fossil|emissions?)\b/.test(text)) return { type: 'set', key: 'fossilCo2ChangePct', value: clamp(sign * Math.abs(n), -100, 60) };
    if (/\b(years?|horizon)\b/.test(text)) return { type: 'set', key: 'horizonYears', value: clamp(Math.round(n), 5, 80) };
    if (/\bsensitivity\b/.test(text)) return { type: 'set', key: 'sensitivity', value: clamp(n, 2, 5) };
  }
  for (const [re, view] of VIEWS) if (re.test(text)) return { type: 'goto', view };
  return { type: 'unknown', heard: raw };
}

interface Recognition { lang: string; continuous: boolean; interimResults: boolean; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>; resultIndex: number }) => void) | null; onerror: ((e: { error?: string }) => void) | null; onend: (() => void) | null; start(): void; stop(): void }
type RecognitionCtor = new () => Recognition;
const recognitionCtor = (): RecognitionCtor | undefined => {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition || w.webkitSpeechRecognition;
};

export const voiceSupported = (): boolean => Boolean(recognitionCtor());

/** Starts continuous listening. Returns a stop function; failures are reported through onState, never thrown. */
export function listen(onFinal: (transcript: string) => void, onState: (state: 'listening' | 'idle' | 'error', detail?: string) => void, lang = 'en-IN'): () => void {
  const Ctor = recognitionCtor();
  if (!Ctor) { onState('error', 'Voice recognition is not available in this browser. Use Chrome or Edge, or use the on-screen controls.'); return () => undefined; }
  const rec = new Ctor();
  rec.lang = lang; rec.continuous = true; rec.interimResults = false;
  let stopped = false;
  let errored = false;
  rec.onresult = (e) => { for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) onFinal(e.results[i][0].transcript); };
  rec.onerror = (e) => { if (e.error === 'no-speech' || e.error === 'aborted') return; stopped = true; errored = true; onState('error', e.error === 'not-allowed' ? 'Microphone permission was denied.' : `Voice recognition failed: ${e.error ?? 'unknown error'}.`); };
  rec.onend = () => { if (!stopped) { try { rec.start(); return; } catch { /* fall through to idle */ } } if (!errored) onState('idle'); };
  try { rec.start(); onState('listening'); } catch (error) { onState('error', error instanceof Error ? error.message : 'Voice recognition could not start.'); }
  return () => { stopped = true; try { rec.stop(); } catch { /* already stopped */ } };
}

export function speak(text: string): boolean {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return false;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text.slice(0, 1200));
  u.rate = 1;
  window.speechSynthesis.speak(u);
  return true;
}
