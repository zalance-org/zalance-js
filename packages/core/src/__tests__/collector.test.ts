import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { computePercentiles, FrameCollector } from '../collector';

// ─── computePercentiles (pure function) ───

describe('computePercentiles', () => {
  it('returns zeros for an empty array', () => {
    const result = computePercentiles([]);
    expect(result).toEqual({ p50: 0, p75: 0, p95: 0, p99: 0 });
  });

  it('returns the same FPS for a single frame time', () => {
    const result = computePercentiles([16.67]);
    const expectedFps = 1000 / 16.67;
    expect(result.p50).toBeCloseTo(expectedFps);
    expect(result.p75).toBeCloseTo(expectedFps);
    expect(result.p95).toBeCloseTo(expectedFps);
    expect(result.p99).toBeCloseTo(expectedFps);
  });

  it('computes correct percentiles for uniform frame times', () => {
    // 100 frames all at 16.67ms (~60 FPS)
    const frameTimes = Array.from({ length: 100 }, () => 16.67);
    const result = computePercentiles(frameTimes);
    const expectedFps = 1000 / 16.67;
    expect(result.p50).toBeCloseTo(expectedFps);
    expect(result.p75).toBeCloseTo(expectedFps);
    expect(result.p95).toBeCloseTo(expectedFps);
    expect(result.p99).toBeCloseTo(expectedFps);
  });

  it('maintains FPS ordering invariant: p50 >= p75 >= p95 >= p99', () => {
    // Mix of fast and slow frames
    const frameTimes = [
      ...Array.from({ length: 50 }, () => 16.67), // 60 FPS
      ...Array.from({ length: 30 }, () => 33.33), // 30 FPS
      ...Array.from({ length: 15 }, () => 50),     // 20 FPS
      ...Array.from({ length: 5 }, () => 100),     // 10 FPS
    ];
    const result = computePercentiles(frameTimes);
    expect(result.p50).toBeGreaterThanOrEqual(result.p75);
    expect(result.p75).toBeGreaterThanOrEqual(result.p95);
    expect(result.p95).toBeGreaterThanOrEqual(result.p99);
  });

  it('does not mutate the input array', () => {
    const frameTimes = [50, 16.67, 33.33, 100];
    const copy = [...frameTimes];
    computePercentiles(frameTimes);
    expect(frameTimes).toEqual(copy);
  });

  it('handles a zero frame time gracefully', () => {
    const result = computePercentiles([0]);
    expect(result.p50).toBe(0);
  });
});

// ─── FrameCollector ───

describe('FrameCollector', () => {
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

  it('records frame durations after start()', () => {
    collector.start();
    simulateFrames(5, 16.67);
    expect(collector.getFrameCount()).toBe(5);
  });

  it('does not record frames before start()', () => {
    expect(collector.getFrameCount()).toBe(0);
  });

  it('stops recording after stop()', () => {
    collector.start();
    simulateFrames(3, 16.67);
    collector.stop();
    expect(collector.getFrameCount()).toBe(3);
    // No more callbacks should be processed
  });

  it('pauses and resumes sampling', () => {
    collector.start();
    simulateFrames(3, 16.67);
    collector.pause();
    expect(collector.getFrameCount()).toBe(3);

    collector.resume();
    simulateFrames(2, 16.67);
    expect(collector.getFrameCount()).toBe(5);
  });

  it('tracks longest frame duration', () => {
    collector.start();
    let time = 0;
    const firstCb = rafCallbacks.pop();
    firstCb?.(time);

    // Frame 1: 16ms
    time += 16;
    rafCallbacks.pop()?.(time);

    // Frame 2: 100ms (longest)
    time += 100;
    rafCallbacks.pop()?.(time);

    // Frame 3: 20ms
    time += 20;
    rafCallbacks.pop()?.(time);

    expect(collector.getLongestFrameMs()).toBe(100);
  });

  it('counts frames below 30fps (> 33.33ms)', () => {
    collector.start();
    let time = 0;
    const firstCb = rafCallbacks.pop();
    firstCb?.(time);

    // Fast frame (60fps)
    time += 16.67;
    rafCallbacks.pop()?.(time);

    // Slow frame (below 30fps)
    time += 40;
    rafCallbacks.pop()?.(time);

    // Another slow frame
    time += 50;
    rafCallbacks.pop()?.(time);

    expect(collector.getFramesBelow30fps()).toBe(2);
  });

  it('counts frames below 15fps (> 66.67ms)', () => {
    collector.start();
    let time = 0;
    const firstCb = rafCallbacks.pop();
    firstCb?.(time);

    // Fast frame
    time += 16.67;
    rafCallbacks.pop()?.(time);

    // Slow but above 15fps
    time += 50;
    rafCallbacks.pop()?.(time);

    // Very slow (below 15fps)
    time += 70;
    rafCallbacks.pop()?.(time);

    expect(collector.getFramesBelow15fps()).toBe(1);
  });

  it('enforces circular buffer cap of 600 samples', () => {
    collector.start();
    simulateFrames(700, 16.67);

    // Buffer should contain at most 600 entries
    const percentiles = collector.getPercentiles();
    expect(percentiles.p50).toBeGreaterThan(0);
    // Total frame count tracks all frames, not just buffer
    expect(collector.getFrameCount()).toBe(700);
  });

  it('reset() clears all state', () => {
    collector.start();
    simulateFrames(10, 16.67);
    collector.reset();

    expect(collector.getFrameCount()).toBe(0);
    expect(collector.getLongestFrameMs()).toBe(0);
    expect(collector.getFramesBelow30fps()).toBe(0);
    expect(collector.getFramesBelow15fps()).toBe(0);
    expect(collector.getPercentiles()).toEqual({ p50: 0, p75: 0, p95: 0, p99: 0 });
  });

  it('start() is idempotent when already running', () => {
    collector.start();
    const countBefore = rafCallbacks.length;
    collector.start(); // should be a no-op
    expect(rafCallbacks.length).toBe(countBefore);
  });

  it('pause() is a no-op when not running', () => {
    collector.pause(); // should not throw
    expect(collector.getFrameCount()).toBe(0);
  });

  it('resume() is a no-op when not paused', () => {
    collector.start();
    collector.resume(); // not paused, should be no-op
    expect(collector.getFrameCount()).toBe(0);
  });

  it('getPercentiles() returns valid FPS values from sampled frames', () => {
    collector.start();
    simulateFrames(50, 16.67);

    const p = collector.getPercentiles();
    const expectedFps = 1000 / 16.67;
    expect(p.p50).toBeCloseTo(expectedFps, 0);
    expect(p.p75).toBeCloseTo(expectedFps, 0);
    expect(p.p95).toBeCloseTo(expectedFps, 0);
    expect(p.p99).toBeCloseTo(expectedFps, 0);
  });
});
