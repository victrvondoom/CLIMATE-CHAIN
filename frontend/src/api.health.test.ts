import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchGatewayHealth } from './api';

afterEach(() => vi.unstubAllGlobals());

describe('fetchGatewayHealth', () => {
  it('returns degraded health details on HTTP 503 so the worker state stays inspectable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: 'degraded',
      worker: { status: 'restarting', available: false, workerId: null, pid: null, restartCount: 2, backoffMs: 1000, startedAt: null, lastHeartbeatAt: null, ageMs: 10, errorCode: null },
    }), { status: 503, headers: { 'content-type': 'application/json' } })));

    const health = await fetchGatewayHealth();
    expect(health.status).toBe('degraded');
    expect(health.worker.status).toBe('restarting');
    expect(health.worker.backoffMs).toBe(1000);
  });

  it('polls the status view, which answers a degraded gateway with 200, not the readiness probe', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: 'degraded',
      worker: { status: 'stopped', available: false, workerId: null, pid: null, restartCount: 0, backoffMs: null, startedAt: null, lastHeartbeatAt: null, ageMs: null, errorCode: null },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const health = await fetchGatewayHealth();
    expect(fetchMock.mock.calls[0][0]).toBe('/api/status');
    expect(health.status).toBe('degraded');
    expect(health.worker.available).toBe(false);
  });

  it('continues to reject unrelated server errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 'gateway_error' } }), {
      status: 500, headers: { 'content-type': 'application/json' },
    })));
    await expect(fetchGatewayHealth()).rejects.toThrow('500');
  });
});
