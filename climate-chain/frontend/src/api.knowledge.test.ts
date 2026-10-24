import { afterEach, describe, expect, it, vi } from 'vitest';
import { searchKnowledge } from './api';

afterEach(() => vi.unstubAllGlobals());

describe('searchKnowledge', () => {
  it('sends the query and limit to the retrieval route and returns cited excerpts without a generated answer', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      query: 'methane', mode: 'lexical-bm25', answered: false, note: 'Ranked excerpts.',
      results: [{ id: 'a', source: 'registry/projects.json', title: 'Registry', heading: 'PLUME', startLine: 1, score: 1.2, snippet: 'Methane detection' }],
      index: { documents: 2, chunks: 9, builtAt: '2026-10-23T00:00:00.000Z' }, asOf: '2026-10-23T00:00:00.000Z',
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await searchKnowledge('methane', 5);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('/api/v1/knowledge/search?');
    expect(url).toContain('q=methane');
    expect(url).toContain('limit=5');
    expect(result.answered).toBe(false);
    expect(result.results[0].source).toBe('registry/projects.json');
  });

  it('rejects when the gateway refuses the query', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 'query_too_short', message: 'q must be at least 2 characters.' } }), {
      status: 400, headers: { 'content-type': 'application/json' },
    })));
    await expect(searchKnowledge('a')).rejects.toThrow();
  });
});