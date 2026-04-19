import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Control when GPU tier resolves
let resolveGpuTier: (value: unknown) => void;

vi.mock('detect-gpu', () => ({
  getGPUTier: vi.fn(
    () => new Promise((resolve) => { resolveGpuTier = resolve; }),
  ),
}));

vi.mock('../transport', () => ({
  postWithRetry: vi.fn(() => Promise.resolve({ ok: true })),
  sleep: vi.fn(() => Promise.resolve()),
}));

import { init } from '../client';
import { postWithRetry } from '../transport';

const mockedPostWithRetry = vi.mocked(postWithRetry);

function createMockRenderer() {
  const canvas = document.createElement('canvas');
  return {
    getContext: () => ({
      getExtension: vi.fn(() => null),
      getParameter: vi.fn(() => 'WebGL 2.0'),
      VERSION: 0x1f02,
    }),
    domElement: canvas,
    info: {
      render: { calls: 10, triangles: 5000 },
      memory: { geometries: 2, textures: 4 },
      programs: [1],
    },
  };
}

describe('client', () => {
  let mockSendBeacon: ReturnType<typeof vi.fn>;
  let uuidCounter: number;

  beforeEach(() => {
    mockedPostWithRetry.mockClear();

    mockSendBeacon = vi.fn(() => true);
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        sendBeacon: mockSendBeacon,
        userAgent: 'test-agent',
      },
      writable: true,
      configurable: true,
    });

    uuidCounter = 0;
    vi.stubGlobal('crypto', {
      randomUUID: () => `test-uuid-${++uuidCounter}`,
    });

    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('init() returns a ZalanceHandle with expected methods', () => {
    const renderer = createMockRenderer();
    const handle = init({ apiKey: 'key-1', renderer });

    expect(handle).toHaveProperty('getSessionId');
    expect(handle).toHaveProperty('trackEvent');
    expect(handle).toHaveProperty('stop');
    expect(typeof handle.getSessionId).toBe('function');
    expect(typeof handle.trackEvent).toBe('function');
    expect(typeof handle.stop).toBe('function');

    handle.stop();
  });

  it('getSessionId() returns a valid UUID string', () => {
    const renderer = createMockRenderer();
    const handle = init({ apiKey: 'key-2', renderer });

    const sessionId = handle.getSessionId();
    expect(typeof sessionId).toBe('string');
    expect(sessionId.length).toBeGreaterThan(0);
    expect(sessionId).toContain('test-uuid');

    handle.stop();
  });

  it('idempotent init — second call returns same handle', () => {
    const renderer = createMockRenderer();
    const handle1 = init({ apiKey: 'key-3', renderer });
    const handle2 = init({ apiKey: 'key-3', renderer });

    expect(handle1).toBe(handle2);
    expect(handle1.getSessionId()).toBe(handle2.getSessionId());

    handle1.stop();
  });

  it('trackEvent() queues events before init completes', () => {
    const renderer = createMockRenderer();
    const handle = init({ apiKey: 'key-4', renderer });

    // GPU tier hasn't resolved yet, so backgroundInit hasn't completed
    handle.trackEvent('test-event', { foo: 'bar' });

    // Events should be queued, not sent via postWithRetry to /ingest/event
    const eventCalls = mockedPostWithRetry.mock.calls.filter(
      ([url]) => typeof url === 'string' && url.includes('/ingest/event'),
    );
    expect(eventCalls).toHaveLength(0);

    handle.stop();
  });

  it('event queue overflow — 51st event discards oldest', async () => {
    const renderer = createMockRenderer();
    const handle = init({ apiKey: 'key-5', renderer });

    // Push 51 events while init is pending (GPU tier unresolved)
    for (let i = 1; i <= 51; i++) {
      handle.trackEvent(`event-${i}`);
    }

    // Now resolve GPU tier to trigger backgroundInit completion + event flush
    resolveGpuTier({ tier: 2, type: 'BENCHMARK' });
    // Let microtasks settle
    await new Promise((r) => setTimeout(r, 0));

    // After flush, events should have been sent via postWithRetry
    const eventCalls = mockedPostWithRetry.mock.calls.filter(
      ([url]) => typeof url === 'string' && url.includes('/ingest/event'),
    );

    // Queue max is 50, so event-1 was discarded. 50 events flushed.
    expect(eventCalls).toHaveLength(50);

    // First flushed event should be event-2 (event-1 was discarded)
    const firstEventPayload = eventCalls[0][1] as Record<string, unknown>;
    expect(firstEventPayload.name).toBe('event-2');

    handle.stop();
  });

  it('stop() cleans up all resources', () => {
    const renderer = createMockRenderer();
    const handle = init({ apiKey: 'key-6', renderer });
    const sessionId1 = handle.getSessionId();

    handle.stop();

    // After stop, a new init should create a fresh handle with a new session
    const handle2 = init({ apiKey: 'key-7', renderer: createMockRenderer() });
    expect(handle2).not.toBe(handle);
    // getSessionId() on the old handle returns '' after stop (state reset)
    // The new handle should have a different session ID
    expect(handle2.getSessionId()).not.toBe(sessionId1);

    handle2.stop();
  });

  it('webglcontextlost/restored auto-events are tracked', () => {
    const renderer = createMockRenderer();
    const handle = init({ apiKey: 'key-8', renderer });

    // Dispatch context events on the canvas
    const canvas = renderer.domElement;
    canvas.dispatchEvent(new Event('webglcontextlost'));
    canvas.dispatchEvent(new Event('webglcontextrestored'));

    // Events should be queued without errors
    handle.stop();
  });

  it('sendBeacon is called on stop() with correct SessionEndPayload structure', async () => {
    const renderer = createMockRenderer();
    const handle = init({ apiKey: 'key-9', renderer });

    // Resolve GPU tier so batcher has data
    resolveGpuTier({ tier: 2, type: 'BENCHMARK' });
    await new Promise((r) => setTimeout(r, 0));

    handle.stop();

    expect(mockSendBeacon).toHaveBeenCalled();
    const beaconCall = mockSendBeacon.mock.calls.find(
      ([url]: [string]) => typeof url === 'string' && url.includes('/ingest/session-end'),
    );
    expect(beaconCall).toBeDefined();

    const payload = JSON.parse(beaconCall![1]);
    expect(payload).toHaveProperty('apiKey', 'key-9');
    expect(payload).toHaveProperty('sessionId');
    expect(payload).toHaveProperty('endedAt');
    expect(payload).toHaveProperty('finalSummary');
    expect(payload.finalSummary).toHaveProperty('frameCount');
    expect(payload.finalSummary).toHaveProperty('fpsP50');
    expect(payload.finalSummary).toHaveProperty('peakDrawCalls');
    expect(payload.finalSummary).toHaveProperty('contextLostCount');
  });
});
