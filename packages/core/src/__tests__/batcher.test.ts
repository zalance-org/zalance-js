import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock transport module
vi.mock('../transport', () => ({
  postWithRetry: vi.fn(() => Promise.resolve({ ok: true })),
}));

import { MetricBatcher } from '../batcher';
import { postWithRetry } from '../transport';
import type { FrameCollector } from '../collector';

const mockedPostWithRetry = vi.mocked(postWithRetry);

function createMockCollector(overrides: Partial<FrameCollector> = {}): FrameCollector {
  return {
    getPercentiles: vi.fn(() => ({ p50: 60, p75: 55, p95: 40, p99: 30 })),
    getFrameCount: vi.fn(() => 100),
    getLongestFrameMs: vi.fn(() => 50),
    getFramesBelow30fps: vi.fn(() => 5),
    getFramesBelow15fps: vi.fn(() => 1),
    start: vi.fn(),
    stop: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    reset: vi.fn(),
    ...overrides,
  } as unknown as FrameCollector;
}

function createMockRenderer(info?: unknown) {
  return {
    info: info ?? {
      render: { calls: 42, triangles: 10000 },
      memory: { geometries: 5, textures: 8 },
      programs: [1, 2, 3],
    },
  };
}

function createBatcher(
  collector?: FrameCollector,
  renderer?: unknown,
): MetricBatcher {
  return new MetricBatcher({
    apiKey: 'test-key',
    sessionId: 'test-session',
    endpoint: 'https://api.test.com',
    sdkVersion: '1.0.0',
    renderer: renderer ?? createMockRenderer(),
    collector: collector ?? createMockCollector(),
  });
}

describe('MetricBatcher', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockedPostWithRetry.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('flush() reads renderer.info and sends correct MetricBatchPayload', () => {
    const batcher = createBatcher();
    batcher.setGpuTier('mid');
    batcher.flush();

    expect(mockedPostWithRetry).toHaveBeenCalledTimes(1);
    const [url, payload] = mockedPostWithRetry.mock.calls[0];
    expect(url).toBe('https://api.test.com/ingest/batch');
    expect(payload).toMatchObject({
      apiKey: 'test-key',
      sessionId: 'test-session',
      gpuTier: 'mid',
      drawCalls: 42,
      triangles: 10000,
      textures: 8,
      geometries: 5,
      programs: 3,
      sdkVersion: '1.0.0',
      fpsP50: 60,
      fpsP75: 55,
      fpsP95: 40,
      fpsP99: 30,
    });
    expect(payload).toHaveProperty('capturedAt');
  });

  it('buffers batches when gpuTier is not set', () => {
    const batcher = createBatcher();
    batcher.flush();

    // Should NOT have called postWithRetry — batch is buffered
    expect(mockedPostWithRetry).not.toHaveBeenCalled();
    expect(batcher.getPendingBatches()).toHaveLength(1);
  });

  it('setGpuTier() flushes buffered batches with correct tier', () => {
    const batcher = createBatcher();
    batcher.flush(); // buffered
    batcher.flush(); // buffered

    expect(mockedPostWithRetry).not.toHaveBeenCalled();
    expect(batcher.getPendingBatches()).toHaveLength(2);

    batcher.setGpuTier('high');

    // Both buffered batches should now be sent with tier 'high'
    expect(mockedPostWithRetry).toHaveBeenCalledTimes(2);
    for (const call of mockedPostWithRetry.mock.calls) {
      expect(call[1]).toMatchObject({ gpuTier: 'high' });
    }
    expect(batcher.getPendingBatches()).toHaveLength(0);
  });

  it('peak value accumulators update correctly across multiple flushes', () => {
    // First flush: drawCalls=42, triangles=10000
    const renderer1 = createMockRenderer({
      render: { calls: 42, triangles: 10000 },
      memory: { geometries: 5, textures: 8 },
      programs: [1, 2, 3],
    });
    const collector = createMockCollector();
    const batcher = new MetricBatcher({
      apiKey: 'test-key',
      sessionId: 'test-session',
      endpoint: 'https://api.test.com',
      sdkVersion: '1.0.0',
      renderer: renderer1,
      collector,
    });
    batcher.setGpuTier('mid');
    batcher.flush();

    // Mutate renderer info for second flush with higher values
    renderer1.info.render.calls = 100;
    renderer1.info.render.triangles = 50000;
    renderer1.info.memory.textures = 20;
    batcher.flush();

    const summary = batcher.getSessionSummary();
    expect(summary.peakDrawCalls).toBe(100);
    expect(summary.peakTriangles).toBe(50000);
    expect(summary.peakTextures).toBe(20);
    expect(summary.peakGeometries).toBe(5);
    expect(summary.peakPrograms).toBe(3);
  });

  it('getSessionSummary() returns correct accumulated values', () => {
    const collector = createMockCollector();
    const batcher = createBatcher(collector);
    batcher.setGpuTier('low');
    batcher.flush();

    batcher.incrementContextLost();
    batcher.incrementContextLost();
    batcher.incrementContextRestored();

    const summary = batcher.getSessionSummary();
    expect(summary).toMatchObject({
      frameCount: 100,
      fpsP50: 60,
      fpsP75: 55,
      fpsP95: 40,
      fpsP99: 30,
      longestFrameMs: 50,
      framesBelow30fps: 5,
      framesBelow15fps: 1,
      peakDrawCalls: 42,
      peakTriangles: 10000,
      peakTextures: 8,
      peakGeometries: 5,
      peakPrograms: 3,
      contextLostCount: 2,
      contextRestoredCount: 1,
    });
  });

  it('incrementContextLost() / incrementContextRestored() update counts', () => {
    const batcher = createBatcher();

    batcher.incrementContextLost();
    batcher.incrementContextLost();
    batcher.incrementContextRestored();

    const summary = batcher.getSessionSummary();
    expect(summary.contextLostCount).toBe(2);
    expect(summary.contextRestoredCount).toBe(1);
  });

  it('getPendingBatches() returns buffered batches', () => {
    const batcher = createBatcher();
    batcher.flush();
    batcher.flush();

    const pending = batcher.getPendingBatches();
    expect(pending).toHaveLength(2);
    // Verify it's a copy, not the internal array
    pending.pop();
    expect(batcher.getPendingBatches()).toHaveLength(2);
  });

  it('renderer with missing info properties defaults to 0', () => {
    const emptyRenderer = { info: {} };
    const batcher = createBatcher(undefined, emptyRenderer);
    batcher.setGpuTier('mid');
    batcher.flush();

    expect(mockedPostWithRetry).toHaveBeenCalledTimes(1);
    const payload = mockedPostWithRetry.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.drawCalls).toBe(0);
    expect(payload.triangles).toBe(0);
    expect(payload.textures).toBe(0);
    expect(payload.geometries).toBe(0);
    expect(payload.programs).toBe(0);
  });

  it('renderer with no info at all defaults to 0', () => {
    const noInfoRenderer = {};
    const batcher = createBatcher(undefined, noInfoRenderer);
    batcher.setGpuTier('mid');
    batcher.flush();

    const payload = mockedPostWithRetry.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.drawCalls).toBe(0);
    expect(payload.triangles).toBe(0);
    expect(payload.textures).toBe(0);
    expect(payload.geometries).toBe(0);
    expect(payload.programs).toBe(0);
  });

  it('start() triggers captureAndSend every 10 seconds', () => {
    const batcher = createBatcher();
    batcher.setGpuTier('mid');
    batcher.start();

    vi.advanceTimersByTime(10_000);
    expect(mockedPostWithRetry).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(10_000);
    expect(mockedPostWithRetry).toHaveBeenCalledTimes(2);

    batcher.stop();
  });
});
