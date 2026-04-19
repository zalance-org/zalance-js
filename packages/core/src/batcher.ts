import type {
  GPUTier,
  MetricBatchPayload,
  SessionFinalSummary,
} from '@zalance/types';
import type { FrameCollector } from './collector';
import { postWithRetry } from './transport';

export interface MetricBatcherConfig {
  apiKey: string;
  sessionId: string;
  endpoint: string;
  sdkVersion: string;
  renderer: unknown;
  collector: FrameCollector;
}

/**
 * Captures renderer metrics every 10 seconds, builds MetricBatchPayload,
 * and POSTs to the ingest service. Buffers batches until GPU tier is resolved.
 */
export class MetricBatcher {
  private readonly apiKey: string;
  private readonly sessionId: string;
  private readonly endpoint: string;
  private readonly sdkVersion: string;
  private readonly renderer: unknown;
  private readonly collector: FrameCollector;

  private intervalId: ReturnType<typeof setInterval> | null = null;
  private gpuTier: GPUTier | null = null;
  private bufferedBatches: MetricBatchPayload[] = [];

  /** Session summary accumulators */
  private peakDrawCalls = 0;
  private peakTriangles = 0;
  private peakTextures = 0;
  private peakGeometries = 0;
  private peakPrograms = 0;
  private contextLostCount = 0;
  private contextRestoredCount = 0;

  constructor(config: MetricBatcherConfig) {
    this.apiKey = config.apiKey;
    this.sessionId = config.sessionId;
    this.endpoint = config.endpoint;
    this.sdkVersion = config.sdkVersion;
    this.renderer = config.renderer;
    this.collector = config.collector;
  }

  /** Starts the 10-second metric capture interval. */
  start(): void {
    if (this.intervalId !== null) return;
    this.intervalId = setInterval(() => this.captureAndSend(), 10_000);
  }

  /** Stops the interval timer. */
  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /**
   * Called when async GPU classification completes.
   * Updates any buffered batches with the resolved tier and flushes them.
   */
  setGpuTier(tier: GPUTier): void {
    this.gpuTier = tier;

    if (this.bufferedBatches.length > 0) {
      const toFlush = this.bufferedBatches.map((batch) => ({
        ...batch,
        gpuTier: tier,
      }));
      this.bufferedBatches = [];

      for (const batch of toFlush) {
        postWithRetry(`${this.endpoint}/ingest/batch`, batch);
      }
    }
  }

  /** Immediately captures current metrics and sends (or buffers) a batch. */
  flush(): void {
    this.captureAndSend();
  }

  /** Returns the accumulated session summary for the final beacon. */
  getSessionSummary(): SessionFinalSummary {
    const percentiles = this.collector.getPercentiles();

    return {
      frameCount: this.collector.getFrameCount(),
      fpsP50: percentiles.p50,
      fpsP75: percentiles.p75,
      fpsP95: percentiles.p95,
      fpsP99: percentiles.p99,
      longestFrameMs: this.collector.getLongestFrameMs(),
      framesBelow30fps: this.collector.getFramesBelow30fps(),
      framesBelow15fps: this.collector.getFramesBelow15fps(),
      peakDrawCalls: this.peakDrawCalls,
      peakTriangles: this.peakTriangles,
      peakTextures: this.peakTextures,
      peakGeometries: this.peakGeometries,
      peakPrograms: this.peakPrograms,
      contextLostCount: this.contextLostCount,
      contextRestoredCount: this.contextRestoredCount,
    };
  }

  /** Returns any unsent buffered batches (for beacon on page close). */
  getPendingBatches(): MetricBatchPayload[] {
    return this.bufferedBatches.slice();
  }

  incrementContextLost(): void {
    this.contextLostCount++;
  }

  incrementContextRestored(): void {
    this.contextRestoredCount++;
  }

  /**
   * Reads renderer.info, computes FPS percentiles, builds a batch payload,
   * and either sends it immediately or buffers it if GPU tier is unresolved.
   */
  private captureAndSend(): void {
    const rendererInfo = this.readRendererInfo();
    const percentiles = this.collector.getPercentiles();

    // Update peak accumulators
    this.peakDrawCalls = Math.max(this.peakDrawCalls, rendererInfo.drawCalls);
    this.peakTriangles = Math.max(this.peakTriangles, rendererInfo.triangles);
    this.peakTextures = Math.max(this.peakTextures, rendererInfo.textures);
    this.peakGeometries = Math.max(
      this.peakGeometries,
      rendererInfo.geometries,
    );
    this.peakPrograms = Math.max(this.peakPrograms, rendererInfo.programs);

    const batch: MetricBatchPayload = {
      apiKey: this.apiKey,
      sessionId: this.sessionId,
      gpuTier: this.gpuTier ?? 'unknown',
      capturedAt: new Date().toISOString(),
      fpsP50: percentiles.p50,
      fpsP75: percentiles.p75,
      fpsP95: percentiles.p95,
      fpsP99: percentiles.p99,
      drawCalls: rendererInfo.drawCalls,
      triangles: rendererInfo.triangles,
      textures: rendererInfo.textures,
      geometries: rendererInfo.geometries,
      programs: rendererInfo.programs,
      sdkVersion: this.sdkVersion,
    };

    if (this.gpuTier === null) {
      // GPU tier not resolved yet — buffer for later
      this.bufferedBatches.push(batch);
    } else {
      postWithRetry(`${this.endpoint}/ingest/batch`, batch);
    }
  }

  /**
   * Reads Three.js renderer.info safely.
   * Handles missing properties gracefully by defaulting to 0.
   */
  private readRendererInfo(): {
    drawCalls: number;
    triangles: number;
    geometries: number;
    textures: number;
    programs: number;
  } {
    try {
      const info = (this.renderer as any)?.info;
      return {
        drawCalls: info?.render?.calls ?? 0,
        triangles: info?.render?.triangles ?? 0,
        geometries: info?.memory?.geometries ?? 0,
        textures: info?.memory?.textures ?? 0,
        programs: Array.isArray(info?.programs) ? info.programs.length : 0,
      };
    } catch {
      return {
        drawCalls: 0,
        triangles: 0,
        geometries: 0,
        textures: 0,
        programs: 0,
      };
    }
  }
}
