import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { postWithRetry } from '../transport';

describe('postWithRetry', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns response on successful request', async () => {
    const fakeResponse = { ok: true, status: 200 } as Response;
    mockFetch.mockResolvedValueOnce(fakeResponse);

    const result = await postWithRetry('https://api.test.com/ingest', { data: 1 });

    expect(result).toBe(fakeResponse);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith('https://api.test.com/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: 1 }),
    });
  });

  it('retries on 5xx errors with exponential backoff', async () => {
    const error500 = { ok: false, status: 500 } as Response;
    const success = { ok: true, status: 200 } as Response;

    mockFetch
      .mockResolvedValueOnce(error500)
      .mockResolvedValueOnce(error500)
      .mockResolvedValueOnce(success);

    const promise = postWithRetry('https://api.test.com/ingest', {});

    // After first attempt fails: sleep(1000)
    await vi.advanceTimersByTimeAsync(1000);
    // After second attempt fails: sleep(2000)
    await vi.advanceTimersByTimeAsync(2000);

    const result = await promise;

    expect(result).toBe(success);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('does NOT retry on 4xx client errors', async () => {
    const error400 = { ok: false, status: 400 } as Response;
    mockFetch.mockResolvedValueOnce(error400);

    const result = await postWithRetry('https://api.test.com/ingest', {});

    expect(result).toBe(error400);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry on 404 client error', async () => {
    const error404 = { ok: false, status: 404 } as Response;
    mockFetch.mockResolvedValueOnce(error404);

    const result = await postWithRetry('https://api.test.com/ingest', {});

    expect(result).toBe(error404);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('returns null after max retries exhausted', async () => {
    const error500 = { ok: false, status: 500 } as Response;
    mockFetch.mockResolvedValue(error500);

    const promise = postWithRetry('https://api.test.com/ingest', {}, 3);

    // Advance through backoff: 1s after attempt 0, 2s after attempt 1
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(2000);

    const result = await promise;

    expect(result).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('retries on network error (fetch throws)', async () => {
    const success = { ok: true, status: 200 } as Response;
    mockFetch
      .mockRejectedValueOnce(new Error('Network failure'))
      .mockResolvedValueOnce(success);

    const promise = postWithRetry('https://api.test.com/ingest', {});

    // Advance through first backoff: 1s
    await vi.advanceTimersByTimeAsync(1000);

    const result = await promise;

    expect(result).toBe(success);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('returns null when all retries fail with network errors', async () => {
    mockFetch.mockRejectedValue(new Error('Network failure'));

    const promise = postWithRetry('https://api.test.com/ingest', {}, 3);

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(2000);

    const result = await promise;

    expect(result).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });
});
