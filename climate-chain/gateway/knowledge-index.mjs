// Read-only retrieval over the merged Climate Chain workspace: the root docs,
// project READMEs and docs, the project registry, and the reverse-engineered
// feature catalogue. Lexical BM25 only. Nothing here calls a model, so every
// result is a redacted excerpt with its source file, and no answer is claimed.
// Request input chooses a query and a limit. It never chooses a file path.

import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

export const KNOWLEDGE_MODE = 'lexical-bm25';
const MAX_FILE_BYTES = 256 * 1024;
const MAX_DOCUMENTS = 300;
const MAX_CHUNKS = 8000;
const CHUNK_CHARS = 900;
const SNIPPET_CHARS = 280;
const CACHE_MS = 5 * 60_000;
const BM25_K1 = 1.2;
const BM25_B = 0.75;
const MAX_QUERY_CHARS = 200;
const MAX_LIMIT = 20;
const DEFAULT_LIMIT = 8;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.playwright-cli', '.claude']);
const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'can', 'do', 'does', 'for', 'from', 'how',
  'in', 'is', 'it', 'its', 'of', 'on', 'or', 'the', 'this', 'that', 'these', 'those', 'to',
  'what', 'where', 'which', 'who', 'with',
]);
// Applied to the whole document and to every chunk before it is stored, so a secret-shaped
// string is removed before it can be split across chunks or reach a snippet.
const REDACTIONS = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[redacted private key]'],
  [/\b0x[a-fA-F0-9]{64}\b/g, '[redacted key]'],
  [/\b(?:sk|pk|rk)[_-][A-Za-z0-9_-]{16,}\b/g, '[redacted token]'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, '[redacted token]'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, '[redacted token]'],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g, '[redacted token]'],
  [/\bAIza[0-9A-Za-z_-]{30,}\b/g, '[redacted token]'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[redacted token]'],
  [/\bA(?:KIA|SIA)[A-Z0-9]{16}\b/g, '[redacted key id]'],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 [redacted]'],
  [/(:\/\/[^\s/:@]+):[^\s/@]+@/g, '$1:[redacted]@'],
  [/\b([A-Za-z_]*(?:api[_-]?key|secret|token|password|passwd|private[_-]?key)[A-Za-z_]*)(["']?\s*[:=]\s*["']?)[^\s"',;]{6,}/gi, '$1$2[redacted]'],
];

export class KnowledgeError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'KnowledgeError';
    this.code = code;
    this.status = status;
  }
}

export function redact(text) {
  return REDACTIONS.reduce((value, [pattern, replacement]) => value.replace(pattern, replacement), String(text ?? ''));
}

export function tokenize(text) {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length > 1 && !STOPWORDS.has(term))
    .map((term) => (term.length > 3 && term.endsWith('s') && !term.endsWith('ss') ? term.slice(0, -1) : term));
}

// Removes markdown syntax for display only. Underscores are kept inside words, so identifiers such as
// stacked_verifier.py survive; only emphasis underscores at the edge of a word are removed.
function plainText(markdown) {
  return markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*{1,3}|`{1,3}/g, '')
    .replace(/(^|\s)_{1,3}(?=\S)|(?<=\S)_{1,3}(?=\s|$|[.,;:!?)])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function makeChunk(source, title, heading, startLine, rawText) {
  const text = plainText(redact(rawText));
  if (text.length < 12) return null;
  const id = createHash('sha256').update(`${source}#${startLine}#${text}`).digest('hex').slice(0, 16);
  return { id, source, title: plainText(redact(title)), heading: plainText(redact(heading)), startLine, text };
}

// Breaks a paragraph at spaces so no word or identifier is cut in half.
function splitAtWordBoundary(paragraph) {
  const pieces = [];
  let rest = paragraph;
  while (rest.length > CHUNK_CHARS) {
    let cut = rest.lastIndexOf(' ', CHUNK_CHARS);
    if (cut <= 0) cut = CHUNK_CHARS;
    pieces.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  if (rest) pieces.push(rest);
  return pieces;
}

// Packs a section into passages of at most CHUNK_CHARS, so each chunk is one citable passage.
function packParagraphs(source, title, heading, startLine, body) {
  const paragraphs = body.join('\n').split(/\n\s*\n/);
  const chunks = [];
  let buffer = '';
  const flush = () => {
    const chunk = makeChunk(source, title, heading, startLine, buffer);
    if (chunk) chunks.push(chunk);
    buffer = '';
  };
  for (const paragraph of paragraphs) {
    for (const piece of splitAtWordBoundary(paragraph)) {
      if (buffer && buffer.length + piece.length + 1 > CHUNK_CHARS) flush();
      buffer = buffer ? `${buffer}\n${piece}` : piece;
    }
  }
  flush();
  return chunks;
}

export function chunkMarkdown(source, markdown) {
  const lines = redact(markdown).split(/\r?\n/);
  const chunks = [];
  const fallbackTitle = path.posix.basename(source, '.md');
  let title = fallbackTitle;
  let heading = fallbackTitle;
  let startLine = 1;
  let body = [];
  let openFence = null;
  for (const [index, line] of lines.entries()) {
    const fence = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence) {
      // A fence closes only on the same marker character, with at least as many characters as it opened with.
      if (openFence === null) openFence = fence[1];
      else if (fence[1][0] === openFence[0] && fence[1].length >= openFence.length) openFence = null;
      body.push(line);
      continue;
    }
    const match = openFence === null ? /^(#{1,4})\s+(.+?)(?:\s+#+)?\s*$/.exec(line) : null;
    if (!match) {
      body.push(line);
      continue;
    }
    chunks.push(...packParagraphs(source, title, heading, startLine, body));
    body = [];
    if (match[1].length === 1 && title === fallbackTitle) title = match[2];
    heading = match[2];
    startLine = index + 1;
  }
  chunks.push(...packParagraphs(source, title, heading, startLine, body));
  return chunks;
}

const list = (value) => (Array.isArray(value) ? value : []);

// JSON sources have no line numbers, so their chunks carry startLine null.
export function chunkRegistry(source, registry) {
  const chunks = [];
  const tracks = new Map(list(registry.tracks).map((track) => [track.id, track.label]));
  for (const project of list(registry.projects)) {
    const projectTracks = list(project.tracks).map((id) => tracks.get(id) ?? id);
    const text = [
      project.descriptor,
      project.domain && `Domain: ${project.domain}.`,
      projectTracks.length && `IEEE tracks: ${projectTracks.join('; ')}.`,
      list(project.stages).length && `Mission stages: ${list(project.stages).join(', ')}.`,
      list(project.features).length && `Features: ${list(project.features).join('; ')}.`,
      project.evidence && `Evidence: ${project.evidence}.`,
      project.readiness && `Readiness: ${project.readiness}.`,
      list(project.stack).length && `Stack: ${list(project.stack).join(', ')}.`,
    ].filter(Boolean).join(' ');
    const chunk = makeChunk(source, 'Project registry', project.name ?? project.id ?? 'Project', null, text);
    if (chunk) chunks.push(chunk);
  }
  return chunks;
}

export function chunkFeatureCatalogue(source, catalogue) {
  const chunks = [];
  for (const feature of list(catalogue.features)) {
    const implementations = list(feature.implementations);
    const projects = [...new Set(implementations.map((item) => item.projectName).filter(Boolean))];
    const label = projects.join(', ') || 'Feature catalogue';
    const details = implementations.map((item) => {
      const evidence = list(item.evidence).join('; ') || 'no code evidence';
      return `${item.projectName ?? item.projectId}: ${item.summary ?? ''} Kind: ${item.kind ?? 'unknown'}. Status: ${item.status ?? 'unknown'}. Evidence: ${evidence}.`;
    }).join(' ');
    const chunk = makeChunk(source, label, `${feature.name ?? feature.id ?? 'Feature'} (${projects.length} projects)`, null, details);
    if (chunk) chunks.push(chunk);
  }
  return chunks;
}

async function listFiles(dir, depth, maxDepth, accept) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const found = [];
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (depth < maxDepth) found.push(...await listFiles(full, depth + 1, maxDepth, accept));
    } else if (entry.isFile() && accept(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

// Fixed allowlist of roots. Nothing from a request reaches this list. A file that cannot be read is
// recorded in skipped and the rest of the workspace still loads.
export async function loadCorpus(root) {
  const markdownFiles = [
    ...await listFiles(root, 0, 0, (name) => /^(README|SOLUTION|INTEGRATION)\.md$/.test(name)),
    ...await listFiles(path.join(root, 'docs'), 0, 3, (name) => name.endsWith('.md')),
    ...await listFiles(path.join(root, 'projects'), 0, 1, (name) => name.endsWith('.md')),
  ];
  const sources = [...new Set(markdownFiles)].sort();
  const documents = [];
  const chunks = [];
  const skipped = [];
  const register = (source, found) => {
    if (chunks.length + found.length > MAX_CHUNKS) {
      skipped.push({ source, reason: 'chunk_limit' });
      return;
    }
    chunks.push(...found);
    documents.push({ source, chunks: found.length });
  };

  for (const file of sources) {
    const source = path.relative(root, file).split(path.sep).join('/');
    if (documents.length >= MAX_DOCUMENTS) {
      skipped.push({ source, reason: 'document_limit' });
      continue;
    }
    try {
      const info = await stat(file);
      if (info.size > MAX_FILE_BYTES) {
        skipped.push({ source, reason: 'too_large' });
        continue;
      }
      register(source, chunkMarkdown(source, await readFile(file, 'utf8')));
    } catch {
      skipped.push({ source, reason: 'unreadable' });
    }
  }

  for (const [relative, chunker] of [['registry/projects.json', chunkRegistry], ['registry/features.json', chunkFeatureCatalogue]]) {
    let parsed;
    try {
      parsed = JSON.parse(await readFile(path.join(root, relative), 'utf8'));
    } catch {
      skipped.push({ source: relative, reason: 'missing_or_unreadable' });
      continue;
    }
    register(relative, chunker(relative, parsed));
  }
  return { documents, chunks, skipped };
}

export function buildIndex(chunks) {
  const postings = new Map();
  const lengths = [];
  chunks.forEach((chunk, docIndex) => {
    const terms = tokenize(`${chunk.heading} ${chunk.text}`);
    lengths.push(terms.length);
    const counts = new Map();
    for (const term of terms) counts.set(term, (counts.get(term) ?? 0) + 1);
    for (const [term, tf] of counts) {
      if (!postings.has(term)) postings.set(term, []);
      postings.get(term).push([docIndex, tf]);
    }
  });
  const totalLength = lengths.reduce((sum, value) => sum + value, 0);
  return { chunks, postings, lengths, averageLength: totalLength / Math.max(1, lengths.length), count: chunks.length };
}

const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export function searchIndex(index, query, limit) {
  const terms = [...new Set(tokenize(query))];
  if (terms.length === 0) return [];
  const scores = new Map();
  for (const term of terms) {
    const list = index.postings.get(term);
    if (!list) continue;
    const idf = Math.log(1 + (index.count - list.length + 0.5) / (list.length + 0.5));
    for (const [docIndex, tf] of list) {
      const norm = tf + BM25_K1 * (1 - BM25_B + BM25_B * (index.lengths[docIndex] / (index.averageLength || 1)));
      scores.set(docIndex, (scores.get(docIndex) ?? 0) + idf * ((tf * (BM25_K1 + 1)) / norm));
    }
  }
  return [...scores]
    .map(([docIndex, score]) => ({ chunk: index.chunks[docIndex], score }))
    .sort((a, b) => b.score - a.score || byText(a.chunk.source, b.chunk.source) || (a.chunk.startLine ?? 0) - (b.chunk.startLine ?? 0))
    .slice(0, limit)
    .map((hit) => ({ ...hit, terms }));
}

export function excerpt(text, terms) {
  const lower = text.toLowerCase();
  let at = -1;
  for (const term of terms) {
    const found = lower.indexOf(term);
    if (found !== -1 && (at === -1 || found < at)) at = found;
  }
  const start = Math.max(0, (at === -1 ? 0 : at) - Math.floor(SNIPPET_CHARS / 3));
  const body = text.slice(start, start + SNIPPET_CHARS).trim();
  const prefix = start > 0 ? '…' : '';
  const suffix = start + SNIPPET_CHARS < text.length ? '…' : '';
  return `${prefix}${body}${suffix}`;
}

function validateQuery(value) {
  const query = typeof value === 'string' ? value.trim() : '';
  if (query.length < 2) throw new KnowledgeError('query_too_short', 'q must be at least 2 characters.');
  if (query.length > MAX_QUERY_CHARS) throw new KnowledgeError('query_too_long', `q must be ${MAX_QUERY_CHARS} characters or fewer.`);
  return query;
}

function validateLimit(value) {
  const limit = value === undefined ? DEFAULT_LIMIT : Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new KnowledgeError('invalid_limit', `limit must be a whole number from 1 to ${MAX_LIMIT}.`);
  }
  return limit;
}

export function createKnowledgeService({ root, now = () => Date.now(), load = loadCorpus } = {}) {
  let cached = null;
  let building = null;

  async function current() {
    if (cached && now() - cached.loadedAtMs < CACHE_MS) return cached;
    if (!building) {
      building = load(root)
        .then((corpus) => {
          cached = { ...corpus, index: buildIndex(corpus.chunks), loadedAtMs: now(), builtAt: new Date(now()).toISOString() };
          return cached;
        })
        .catch((error) => {
          // A failed rebuild keeps serving the last good index and waits a full cache interval before retrying.
          if (cached) {
            cached.loadedAtMs = now();
            return cached;
          }
          throw error;
        })
        .finally(() => { building = null; });
    }
    return building;
  }

  return {
    async search(query, limit) {
      const text = validateQuery(query);
      const count = validateLimit(limit);
      const corpus = await current();
      const hits = searchIndex(corpus.index, text, count);
      return {
        query: text,
        mode: KNOWLEDGE_MODE,
        answered: false,
        note: 'Ranked excerpts from the workspace files. No answer is generated; open the source to check the claim.',
        results: hits.map(({ chunk, score, terms }) => ({
          id: chunk.id,
          source: chunk.source,
          title: chunk.title,
          heading: chunk.heading,
          startLine: chunk.startLine,
          score: Math.round(score * 10000) / 10000,
          snippet: excerpt(chunk.text, terms),
        })),
        index: { documents: corpus.documents.length, chunks: corpus.chunks.length, builtAt: corpus.builtAt },
        asOf: new Date(now()).toISOString(),
      };
    },
    async sources() {
      const corpus = await current();
      return {
        documents: corpus.documents,
        skipped: corpus.skipped,
        totals: { documents: corpus.documents.length, chunks: corpus.chunks.length },
        builtAt: corpus.builtAt,
        asOf: new Date(now()).toISOString(),
      };
    },
  };
}
