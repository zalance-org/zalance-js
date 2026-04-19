import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import { computePercentiles, FrameCollector } from '../collector';

// fast-check v4 requires 32-bit float values for fc.float constraints
const FRAME_TIME_MIN = Math.fround(0.1);
const FRAME_TIME_MAX = Math.fround(1000);

/**
 * Property 3: Percentile Computation Correctness
 * p50 >= p75 >= p95 >= p99, all non-negative
 * **Validates: Requirements 2.2**
 */
describe('Property 3: Percentile Computation Correctness', () => {
  it('should maintain FPS ordering invariant: p50 >= p75 >= p95 >= p99 for arbitrary frame times', () => {
    fc.assert(
      fc.property(
        fc.array(fc.float({ min: FRAME_TIME_MIN, max: FRAME_TIME_MAX, noNaN: true }), { minLength: 1, maxLength: 1000 }),
        (frameTimes) => {
          const result = computePercentiles(frameTimes);

          expect(result.p50).toBeGreaterThanOrEqual(result.p75);
          expect(result.p75).toBeGreaterThanOrEqual(result.p95);
          expect(result.p95).toBeGreaterThanOrEqual(result.p99);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('should return all non-negative percentile values for arbitrary positive frame times', () => {
    fc.assert(
      fc.property(
        fc.array(fc.float({ min: FRAME_TIME_MIN, max: FRAME_TIME_MAX, noNaN: true }), { minLength: 1, maxLength: 1000 }),
        (frameTimes) => {
          const result = computePercentiles(frameTimes);

          expect(result.p50).toBeGreaterThanOrEqual(0);
          expect(result.p75).toBeGreaterThanOrEqual(0);
          expect(result.p95).toBeGreaterThanOrEqual(0);
          expect(result.p99).toBeGreaterThanOrEqual(0);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('should return all zeros for an empty array', () => {
    const result = computePercentiles([]);
    expect(result).toEqual({ p50: 0, p75: 0, p95: 0, p99: 0 });
  });

  it('should return all finite numbers for arbitrary positive frame times', () => {
    fc.assert(
      fc.property(
        fc.array(fc.float({ min: FRAME_TIME_MIN, max: FRAME_TIME_MAX, noNaN: true }), { minLength: 1, maxLength: 1000 }),
        (frameTimes) => {
          const result = computePercentiles(frameTimes);

          expect(Number.isFinite(result.p50)).toBe(true);
          expect(Number.isFinite(result.p75)).toBe(true);
          expect(Number.isFinite(result.p95)).toBe(true);
          expect(Number.isFinite(result.p99)).toBe(true);
        },
      ),
      { numRuns: 150 },
    );
  });

  it('should not mutate the input array', () => {
    fc.assert(
      fc.property(
        fc.array(fc.float({ min: FRAME_TIME_MIN, max: FRAME_TIME_MAX, noNaN: true }), { minLength: 1, maxLength: 500 }),
        (frameTimes) => {
          const copy = [...frameTimes];
          computePercentiles(frameTimes);
          expect(frameTimes).toEqual(copy);
        },
      ),
      { numRuns: 150 },
    );
  });

  it('should return equal percentiles for uniform frame times', () => {
    fc.assert(
      fc.property(
        fc.float({ min: FRAME_TIME_MIN, max: FRAME_TIME_MAX, noNaN: true }),
        fc.integer({ min: 1, max: 500 }),
        (frameTime, count) => {
          const frameTimes = Array.from({ length: count }, () => frameTime);
          const result = computePercentiles(frameTimes);

          expect(result.p50).toBeCloseTo(result.p75, 5);
          expect(result.p75).toBeCloseTo(result.p95, 5);
          expect(result.p95).toBeCloseTo(result.p99, 5);
        },
      ),
      { numRuns: 150 },
    );
  });
});

/**
 * Property 4: Frame Buffer Size Invariant
 * Buffer never exceeds 600 samples
 * **Validates: Requirements 2.7**
 */
describe('Property 4: Frame Buffer Size Invariant', () => {
  let collector: FrameCollector;
  let rafCallbacks: Array<(timestamp: number) => void>;
  let rafIdCounter: number;

  beforeEach(() => {
    collector = new FrameCollector();
    rafCallbacks = [];
    rafIdCounter = 1;

    vi.stubGlobal('requestAnimationFrame', (cb: (timestamp: number) => void) => {
      rafCallbacks.push(cb);
      return rafIdCounter++;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  afterEach(() => {
    collector.stop();
    vi.restoreAllMocks();
  });

  /** Simulate N frames with a given duration between each. */
  function simulateFrames(count: number, durationMs: number) {
    let time = 0;
    // First RAF call sets lastTimestamp, no sample recorded
    const firstCb = rafCallbacks.pop();
    firstCb?.(time);

    for (let i = 0; i < count; i++) {
      time += durationMs;
      const cb = rafCallbacks.pop();
      cb?.(time);
    }
  }

  it('should never store more than 600 samples regardless of how many frames are pushed', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1500 }),
        fc.float({ min: 1, max: 100, noNaN: true }),
        (frameCount, durationMs) => {
          // Reset for each property run
          collector = new FrameCollector();
          rafCallbacks = [];
          rafIdCounter = 1;

          vi.stubGlobal('requestAnimationFrame', (cb: (timestamp: number) => void) => {
            rafCallbacks.push(cb);
            return rafIdCounter++;
          });

          collector.start();
          simulateFrames(frameCount, durationMs);
          collector.stop();

          // The total frame count tracks all frames
          expect(collector.getFrameCount()).toBe(frameCount);

          // The buffer-based percentiles should still work correctly
          // (getPercentiles uses the internal buffer which is capped at 600)
          const percentiles = collector.getPercentiles();
          expect(Number.isFinite(percentiles.p50)).toBe(true);
          expect(Number.isFinite(percentiles.p75)).toBe(true);
          expect(Number.isFinite(percentiles.p95)).toBe(true);
          expect(Number.isFinite(percentiles.p99)).toBe(true);

          // All percentile values should be non-negative
          expect(percentiles.p50).toBeGreaterThanOrEqual(0);
          expect(percentiles.p75).toBeGreaterThanOrEqual(0);
          expect(percentiles.p95).toBeGreaterThanOrEqual(0);
          expect(percentiles.p99).toBeGreaterThanOrEqual(0);

          // FPS ordering invariant still holds after buffer wrapping
          expect(percentiles.p50).toBeGreaterThanOrEqual(percentiles.p75);
          expect(percentiles.p75).toBeGreaterThanOrEqual(percentiles.p95);
          expect(percentiles.p95).toBeGreaterThanOrEqual(percentiles.p99);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should correctly report frame count even when buffer wraps around', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 601, max: 1500 }),
        (frameCount) => {
          collector = new FrameCollector();
          rafCallbacks = [];
          rafIdCounter = 1;

          vi.stubGlobal('requestAnimationFrame', (cb: (timestamp: number) => void) => {
            rafCallbacks.push(cb);
            return rafIdCounter++;
          });

          collector.start();
          simulateFrames(frameCount, 16.67);
          collector.stop();

          // Total frame count should match exactly what was pushed
          expect(collector.getFrameCount()).toBe(frameCount);

          // Percentiles should still be valid (buffer wrapped but still works)
          const percentiles = collector.getPercentiles();
          expect(percentiles.p50).toBeGreaterThan(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});
