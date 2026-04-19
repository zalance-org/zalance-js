import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VisibilityHandler } from '../visibility';
import type { FrameCollector } from '../collector';
import type { MetricBatcher } from '../batcher';
import type { SessionEndPayload } from '@zalance/types';

function createMockCollector(): FrameCollector {
  return {
    pause: vi.fn(),
    resume: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    getPercentiles: vi.fn(),
    getFrameCount: vi.fn(),
    getLongestFrameMs: vi.fn(),
    getFramesBelow30fps: vi.fn(),
    getFramesBelow15fps: vi.fn(),
    reset: vi.fn(),
  } as unknown as FrameCollector;
}

function createMockBatcher(): MetricBatcher {
  return {
    flush: vi.fn(),
    getSessionSummary: vi.fn(),
    getPendingBatches: vi.fn(() => []),
  } as unknown as MetricBatcher;
}

function createMockEndPayload(): SessionEndPayload {
  return {
    apiKey: 'test-key',
    sessionId: 'test-session',
    endedAt: new Date().toISOString(),
    finalSummary: {
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
      contextLostCount: 0,
      contextRestoredCount: 0,
    },
  };
}

describe('VisibilityHandler', () => {
  let collector: FrameCollector;
  let batcher: MetricBatcher;
  let buildEndPayload: ReturnType<typeof vi.fn>;
  let handler: VisibilityHandler;
  let mockSendBeacon: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    collector = createMockCollector();
    batcher = createMockBatcher();
    buildEndPayload = vi.fn(() => createMockEndPayload());
    mockSendBeacon = vi.fn(() => true);

    vi.stubGlobal('navigator', { sendBeacon: mockSendBeacon });

    handler = new VisibilityHandler({
      endpoint: 'https://api.test.com',
      collector,
      batcher,
      buildEndPayload,
    });
  });

  afterEach(() => {
    handler.detach();
    vi.restoreAllMocks();
  });

  it('attach() registers visibilitychange and pagehide listeners', () => {
    const docSpy = vi.spyOn(document, 'addEventListener');
    const winSpy = vi.spyOn(window, 'addEventListener');

    handler.attach();

    expect(docSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    expect(winSpy).toHaveBeenCalledWith('pagehide', expect.any(Function));
  });

  it('detach() removes the listeners', () => {
    const docRemoveSpy = vi.spyOn(document, 'removeEventListener');
    const winRemoveSpy = vi.spyOn(window, 'removeEventListener');

    handler.attach();
    handler.detach();

    expect(docRemoveSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    expect(winRemoveSpy).toHaveBeenCalledWith('pagehide', expect.any(Function));
  });

  it('hidden state pauses collector and fires sendBeacon', () => {
    handler.attach();

    // Simulate tab going hidden
    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      writable: true,
      configurable: true,
    });
    document.dispatchEvent(new Event('visibilitychange'));

    expect(collector.pause).toHaveBeenCalled();
    expect(mockSendBeacon).toHaveBeenCalledWith(
      'https://api.test.com/ingest/session-end',
      expect.any(String),
    );

    // Verify the beacon payload is valid JSON
    const beaconPayload = JSON.parse(mockSendBeacon.mock.calls[0][1]);
    expect(beaconPayload).toHaveProperty('apiKey', 'test-key');
    expect(beaconPayload).toHaveProperty('sessionId', 'test-session');
  });

  it('visible state resumes collector', () => {
    handler.attach();

    // First go hidden
    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      writable: true,
      configurable: true,
    });
    document.dispatchEvent(new Event('visibilitychange'));

    // Then go visible
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      writable: true,
      configurable: true,
    });
    document.dispatchEvent(new Event('visibilitychange'));

    expect(collector.resume).toHaveBeenCalled();
  });

  it('pagehide fires sendBeacon', () => {
    handler.attach();

    window.dispatchEvent(new Event('pagehide'));

    expect(mockSendBeacon).toHaveBeenCalledWith(
      'https://api.test.com/ingest/session-end',
      expect.any(String),
    );
  });

  it('handles gracefully when sendBeacon is unavailable', () => {
    // Remove sendBeacon
    vi.stubGlobal('navigator', {});

    handler.attach();

    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      writable: true,
      configurable: true,
    });

    // Should not throw
    expect(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    }).not.toThrow();
  });
});
