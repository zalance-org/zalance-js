import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';

// Mock detect-gpu before importing the module under test
vi.mock('detect-gpu', () => ({
  getGPUTier: vi.fn().mockResolvedValue({ tier: 2, type: 'BENCHMARK' }),
}));

// Mock fetch globally to prevent real HTTP calls
const mockFetch = vi.fn().mockResolvedValue({ ok: true });
vi.stubGlobal('fetch', mockFetch);

// Mock navigator.sendBeacon to prevent errors on stop()
vi.stubGlobal('navigator', {
  ...globalThis.navigator,
  sendBeacon: vi.fn().mockReturnValue(true),
  userAgent: 'test-agent',
});

// Mock requestAnimationFrame / cancelAnimationFrame
vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(cb, 0) as unknown as number);
vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));

import { init } from '../client';

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function createMockRenderer() {
  return {
    getContext: () => ({
      getExtension: () => null,
      getParameter: () => 'WebGL 2.0',
      VERSION: 0x1f02,
    }),
    domElement: document.createElement('canvas'),
    info: {
      render: { calls: 0, triangles: 0 },
      memory: { geometries: 0, textures: 0 },
      programs: [],
    },
  };
}

/**
 * Property 1: Session ID Generation Validity
 * Every call to init() produces a session ID that is a valid UUID v4.
 * **Validates: Requirements 1.2**
 */
describe('Property 1: Session ID Generation Validity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should always generate a valid UUID v4 session ID for arbitrary apiKey strings', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 100 }),
        (apiKey) => {
          const mockRenderer = createMockRenderer();
          const handle = init({ apiKey, renderer: mockRenderer });

          try {
            const sessionId = handle.getSessionId();
            expect(sessionId).toMatch(UUID_V4_REGEX);
          } finally {
            handle.stop();
          }
        },
      ),
      { numRuns: 150 },
    );
  });
});


/**
 * Property 2: Initialization Idempotence
 * Multiple init() calls with the same config return the same session ID and handle reference.
 * **Validates: Requirements 1.6**
 */
describe('Property 2: Initialization Idempotence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should return the same session ID and handle reference for N repeated init() calls', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 10 }),
        (n) => {
          const mockRenderer = createMockRenderer();
          const config = { apiKey: 'test-key', renderer: mockRenderer };

          const firstHandle = init(config);

          try {
            const firstSessionId = firstHandle.getSessionId();

            for (let i = 1; i < n; i++) {
              const subsequentHandle = init(config);
              // Same session ID
              expect(subsequentHandle.getSessionId()).toBe(firstSessionId);
              // Same object reference
              expect(subsequentHandle).toBe(firstHandle);
            }
          } finally {
            firstHandle.stop();
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
