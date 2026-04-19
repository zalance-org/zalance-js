export interface DeviceFingerprint {
  gpuRenderer: string;
  gpuVendor: string;
  webglVersion: string;
  webgpuAvailable: boolean;
  devicePixelRatio: number;
  screenWidth: number;
  screenHeight: number;
  userAgent: string;
}

export type GPUTier = 'high' | 'mid' | 'low' | 'unknown';

export interface SessionStartPayload {
  apiKey: string;
  sessionId: string;
  environment: string;
  deviceFingerprint: DeviceFingerprint;
  gpuTier: GPUTier;
  startedAt: string; // ISO 8601
  sdkVersion: string;
}

export interface SessionEndPayload {
  apiKey: string;
  sessionId: string;
  endedAt: string; // ISO 8601
  finalSummary: SessionFinalSummary;
  pendingBatches?: MetricBatchPayload[];
}

export interface SessionFinalSummary {
  frameCount: number;
  fpsP50: number;
  fpsP75: number;
  fpsP95: number;
  fpsP99: number;
  longestFrameMs: number;
  framesBelow30fps: number;
  framesBelow15fps: number;
  peakDrawCalls: number;
  peakTriangles: number;
  peakTextures: number;
  peakGeometries: number;
  peakPrograms: number;
  contextLostCount: number;
  contextRestoredCount: number;
}

export interface MetricBatchPayload {
  apiKey: string;
  sessionId: string;
  gpuTier: GPUTier;
  capturedAt: string; // ISO 8601
  fpsP50: number;
  fpsP75: number;
  fpsP95: number;
  fpsP99: number;
  drawCalls: number;
  triangles: number;
  textures: number;
  geometries: number;
  programs: number;
  sdkVersion: string;
}

export interface EventPayload {
  apiKey: string;
  sessionId: string;
  name: string;
  properties: Record<string, unknown>;
  occurredAt: string; // ISO 8601
  sdkVersion: string;
}

export interface InitConfig {
  apiKey: string;
  renderer: unknown; // THREE.WebGLRenderer - using unknown to avoid Three.js dependency
  environment?: string;
  endpoint?: string;
  sampleRate?: number;
  debug?: boolean;
}
