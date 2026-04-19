import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Hoisted mocks ---
const mocks = vi.hoisted(() => {
  const mockGl = { domElement: document.createElement('canvas') };
  const mockStop = vi.fn();
  const mockHandle = {
    getSessionId: vi.fn(() => 'mock-session-id'),
    trackEvent: vi.fn(),
    stop: mockStop,
  };
  const mockInit = vi.fn(() => mockHandle);

  return {
    mockGl,
    mockStop,
    mockInit,
    cleanup: null as (() => void) | null,
  };
});

// Mock react hooks — avoid dual-copy issues entirely
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useRef: vi.fn((initial: any) => ({ current: initial })),
    useEffect: vi.fn((cb: () => (() => void) | void) => {
      const cleanup = cb();
      if (typeof cleanup === 'function') {
        mocks.cleanup = cleanup;
      }
    }),
  };
});

vi.mock('@react-three/fiber', () => ({
  useThree: (selector: (state: any) => any) =>
    selector ? selector({ gl: mocks.mockGl }) : mocks.mockGl,
}));

vi.mock('@zalance/core', () => ({
  init: mocks.mockInit,
  SDK_VERSION: '1.0.0',
}));

import { PerformanceMonitor } from './index';

describe('PerformanceMonitor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cleanup = null;
  });

  it('calls init() with correct config on mount', () => {
    const result = PerformanceMonitor({
      apiKey: 'test-key',
      environment: 'staging',
      endpoint: 'https://custom.endpoint',
    });

    expect(result).toBeNull();
    expect(mocks.mockInit).toHaveBeenCalledOnce();
    expect(mocks.mockInit).toHaveBeenCalledWith({
      apiKey: 'test-key',
      renderer: mocks.mockGl,
      environment: 'staging',
      endpoint: 'https://custom.endpoint',
    });
  });

  it('calls handle.stop() on cleanup', () => {
    PerformanceMonitor({ apiKey: 'test-key' });

    expect(mocks.mockInit).toHaveBeenCalledOnce();
    expect(mocks.mockStop).not.toHaveBeenCalled();

    // Simulate unmount by calling the captured cleanup
    expect(mocks.cleanup).toBeDefined();
    mocks.cleanup!();

    expect(mocks.mockStop).toHaveBeenCalledOnce();
  });

  it('renders null (no DOM output)', () => {
    const result = PerformanceMonitor({ apiKey: 'test-key' });
    expect(result).toBeNull();
  });
});
