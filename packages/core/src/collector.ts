/**
 * Frame sampling and FPS percentile computation.
 *
 * Uses a requestAnimationFrame loop to measure frame durations,
 * stores them in a circular buffer (max 600 samples), and computes
 * p50/p75/p95/p99 FPS from the collected frame times.
 */

const MAX_BUFFER_SIZE = 600;
const THRESHOLD_30FPS_MS = 1000 / 30; // ~33.33ms
const THRESHOLD_15FPS_MS = 1000 / 15; // ~66.67ms

export interface FpsPercentiles {
  p50: number;
  p75: number;
  p95: number;
  p99: number;
}

/**
 * Computes FPS percentiles from an array of frame times (in ms).
 *
 * Sorts frame times ascending, picks the value at each percentile index,
 * and converts to FPS (1000 / frameTimeMs).
 *
 * FPS ordering invariant: p50 >= p75 >= p95 >= p99
 * (higher percentile = longer frame time = lower FPS).
 */
export function computePercentiles(frameTimes: number[]): FpsPercentiles {
  if (frameTimes.length === 0) {
    return { p50: 0, p75: 0, p95: 0, p99: 0 };
  }

  // Sort ascending — higher indices = longer frames = lower FPS
  const sorted = frameTimes.slice().sort((a, b) => a - b);
  const len = sorted.length;

  const frameTimeAtPercentile = (p: number): number => {
    const index = Math.min(Math.ceil((p / 100) * len) - 1, len - 1);
    return sorted[Math.max(index, 0)];
  };

  const toFps = (ms: number): number => (ms > 0 ? 1000 / ms : 0);

  return {
    p50: toFps(frameTimeAtPercentile(50)),
    p75: toFps(frameTimeAtPercentile(75)),
    p95: toFps(frameTimeAtPercentile(95)),
    p99: toFps(frameTimeAtPercentile(99)),
  };
}

export class FrameCollector {
  /** Circular buffer of frame durations in ms */
  private buffer: number[] = [];
  private writeIndex = 0;
  private count = 0;

  private rafId: number | null = null;
  private lastTimestamp: number | null = null;
  private running = false;
  private paused = false;

  /** Lifetime stats (not reset by the circular buffer wrapping) */
  private totalFrameCount = 0;
  private longestFrameMs = 0;
  private framesBelow30fps = 0;
  private framesBelow15fps = 0;

  constructor() {
    this.buffer = new Array<number>(MAX_BUFFER_SIZE);
  }

  /** Starts the RAF sampling loop. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.paused = false;
    this.lastTimestamp = null;
    this.scheduleFrame();
  }

  /** Stops the RAF loop entirely. */
  stop(): void {
    this.running = false;
    this.paused = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.lastTimestamp = null;
  }

  /** Pauses sampling (e.g. when tab is hidden). */
  pause(): void {
    if (!this.running || this.paused) return;
    this.paused = true;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.lastTimestamp = null;
  }

  /** Resumes sampling after a pause. */
  resume(): void {
    if (!this.running || !this.paused) return;
    this.paused = false;
    this.lastTimestamp = null;
    this.scheduleFrame();
  }

  /** Returns FPS percentiles from the current buffer contents. */
  getPercentiles(): FpsPercentiles {
    return computePercentiles(this.getBufferContents());
  }

  /** Total number of frames sampled (lifetime, not just buffer). */
  getFrameCount(): number {
    return this.totalFrameCount;
  }

  /** Longest frame duration observed (ms). */
  getLongestFrameMs(): number {
    return this.longestFrameMs;
  }

  /** Count of frames with duration > 33.33ms (below 30 FPS). */
  getFramesBelow30fps(): number {
    return this.framesBelow30fps;
  }

  /** Count of frames with duration > 66.67ms (below 15 FPS). */
  getFramesBelow15fps(): number {
    return this.framesBelow15fps;
  }

  /** Clears the buffer and resets all counters. */
  reset(): void {
    this.buffer = new Array<number>(MAX_BUFFER_SIZE);
    this.writeIndex = 0;
    this.count = 0;
    this.totalFrameCount = 0;
    this.longestFrameMs = 0;
    this.framesBelow30fps = 0;
    this.framesBelow15fps = 0;
    this.lastTimestamp = null;
  }

  /** Returns the valid portion of the circular buffer. */
  private getBufferContents(): number[] {
    const size = Math.min(this.count, MAX_BUFFER_SIZE);
    if (size === 0) return [];

    // If buffer hasn't wrapped yet, return the filled portion
    if (this.count <= MAX_BUFFER_SIZE) {
      return this.buffer.slice(0, size);
    }

    // Buffer has wrapped — read from writeIndex to end, then start to writeIndex
    const tail = this.buffer.slice(this.writeIndex, MAX_BUFFER_SIZE);
    const head = this.buffer.slice(0, this.writeIndex);
    return tail.concat(head);
  }

  private scheduleFrame(): void {
    this.rafId = requestAnimationFrame((timestamp) => this.onFrame(timestamp));
  }

  private onFrame(timestamp: number): void {
    if (!this.running || this.paused) return;

    if (this.lastTimestamp !== null) {
      const duration = timestamp - this.lastTimestamp;

      // Write into circular buffer
      this.buffer[this.writeIndex] = duration;
      this.writeIndex = (this.writeIndex + 1) % MAX_BUFFER_SIZE;
      this.count++;

      // Update lifetime stats
      this.totalFrameCount++;
      if (duration > this.longestFrameMs) {
        this.longestFrameMs = duration;
      }
      if (duration > THRESHOLD_30FPS_MS) {
        this.framesBelow30fps++;
      }
      if (duration > THRESHOLD_15FPS_MS) {
        this.framesBelow15fps++;
      }
    }

    this.lastTimestamp = timestamp;
    this.scheduleFrame();
  }
}
