import type {
  InitConfig,
  EventPayload,
  SessionStartPayload,
  SessionEndPayload,
} from '@zalance/types';
import { FrameCollector } from './collector';
import { MetricBatcher } from './batcher';
import { VisibilityHandler } from './visibility';
import { postWithRetry } from './transport';
import { collectDeviceFingerprint } from './device';
import { classifyGPUTier } from './gpu-tier';
import { SDK_VERSION } from './index';

const DEFAULT_ENDPOINT = 'https://api.zalance.dev';
const MAX_EVENT_QUEUE = 50;

export interface ZalanceHandle {
  getSessionId(): string;
  trackEvent(name: string, properties?: Record<string, unknown>): void;
  stop(): void;
}

// --- Module-level singleton state ---
let currentHandle: ZalanceHandle | null = null;
let currentSessionId: string | null = null;
let collector: FrameCollector | null = null;
let batcher: MetricBatcher | null = null;
let visibilityHandler: VisibilityHandler | null = null;
let initComplete = false;
let eventQueue: EventPayload[] = [];

// Store context listener refs for cleanup
let contextLostListener: ((e: Event) => void) | null = null;
let contextRestoredListener: ((e: Event) => void) | null = null;
let canvasRef: HTMLCanvasElement | null = null;

/**
 * Initialises the Zalance SDK. Synchronous — returns a ZalanceHandle immediately.
 *
 * Async background work (GPU classification, session-start POST, event queue flush)
 * is fired-and-forgotten so the caller is never blocked.
 *
 * Idempotent: a second call returns the existing handle.
 */
export function init(config: InitConfig): ZalanceHandle {
  // Idempotent — reuse existing session
  if (currentHandle) return currentHandle;

  const sessionId = crypto.randomUUID();
  const endpoint = config.endpoint ?? DEFAULT_ENDPOINT;
  const environment = config.environment ?? 'production';
  const apiKey = config.apiKey;

  currentSessionId = sessionId;

  // --- Frame collector ---
  const col = new FrameCollector();
  col.start();
  collector = col;

  // --- Metric batcher ---
  const bat = new MetricBatcher({
    apiKey,
    sessionId,
    endpoint,
    sdkVersion: SDK_VERSION,
    renderer: config.renderer,
    collector: col,
  });
  bat.start();
  batcher = bat;

  // --- Visibility handler ---
  const vis = new VisibilityHandler({
    endpoint,
    collector: col,
    batcher: bat,
    buildEndPayload: () => buildEndPayload(apiKey, sessionId, endpoint, bat),
  });
  vis.attach();
  visibilityHandler = vis;

  // --- WebGL context listeners ---
  const canvas = (config.renderer as any)?.domElement as HTMLCanvasElement | undefined;
  if (canvas) {
    canvasRef = canvas;

    contextLostListener = (_e: Event) => {
      bat.incrementContextLost();
      handle.trackEvent('webglcontextlost');
    };
    contextRestoredListener = (_e: Event) => {
      bat.incrementContextRestored();
      handle.trackEvent('webglcontextrestored');
    };

    canvas.addEventListener('webglcontextlost', contextLostListener);
    canvas.addEventListener('webglcontextrestored', contextRestoredListener);
  }

  // --- Async background init (fire-and-forget) ---
  void backgroundInit(apiKey, sessionId, endpoint, environment, config.renderer, bat);

  // --- Build handle ---
  const handle: ZalanceHandle = {
    getSessionId: () => getSessionId(),
    trackEvent: (name, properties) => trackEvent(apiKey, sessionId, endpoint, name, properties),
    stop: () => stop(apiKey, sessionId, endpoint),
  };

  currentHandle = handle;
  return handle;
}

/**
 * Runs GPU classification, posts session-start, and flushes queued events.
 */
async function backgroundInit(
  apiKey: string,
  sessionId: string,
  endpoint: string,
  environment: string,
  renderer: unknown,
  bat: MetricBatcher,
): Promise<void> {
  try {
    // GPU tier classification
    const tier = await classifyGPUTier();
    bat.setGpuTier(tier);

    // Device fingerprint
    const fingerprint = collectDeviceFingerprint(renderer);

    // Session start payload
    const payload: SessionStartPayload = {
      apiKey,
      sessionId,
      environment,
      deviceFingerprint: fingerprint,
      gpuTier: tier,
      startedAt: new Date().toISOString(),
      sdkVersion: SDK_VERSION,
    };

    await postWithRetry(`${endpoint}/ingest/session-start`, payload);
  } catch {
    // Silently discard — SDK must never crash the host app
  }

  // Mark init complete and flush queued events
  initComplete = true;
  flushEventQueue(apiKey, sessionId, endpoint);
}

/**
 * Sends all queued events that were buffered before init completed.
 */
function flushEventQueue(apiKey: string, sessionId: string, endpoint: string): void {
  const queued = eventQueue;
  eventQueue = [];
  for (const event of queued) {
    postWithRetry(`${endpoint}/ingest/event`, event);
  }
}

/**
 * Tracks a custom event. If init hasn't completed yet, the event is queued
 * (max 50 — oldest discarded on overflow per Req 3.5).
 */
function trackEvent(
  apiKey: string,
  sessionId: string,
  endpoint: string,
  name: string,
  properties?: Record<string, unknown>,
): void {
  const event: EventPayload = {
    apiKey,
    sessionId,
    name,
    properties: properties ?? {},
    occurredAt: new Date().toISOString(),
    sdkVersion: SDK_VERSION,
  };

  if (initComplete) {
    postWithRetry(`${endpoint}/ingest/event`, event);
  } else {
    // Queue with overflow protection — discard oldest when full
    if (eventQueue.length >= MAX_EVENT_QUEUE) {
      eventQueue.shift();
    }
    eventQueue.push(event);
  }
}

/** Returns the current session UUID, or empty string if not initialised. */
function getSessionId(): string {
  return currentSessionId ?? '';
}

/**
 * Stops the SDK: halts collection, detaches listeners, sends final beacon,
 * and resets all module state so a fresh init() can be called later.
 */
function stop(apiKey: string, sessionId: string, endpoint: string): void {
  // Stop collector & batcher
  collector?.stop();
  batcher?.stop();

  // Detach visibility handler
  visibilityHandler?.detach();

  // Remove WebGL context listeners
  if (canvasRef) {
    if (contextLostListener) {
      canvasRef.removeEventListener('webglcontextlost', contextLostListener);
    }
    if (contextRestoredListener) {
      canvasRef.removeEventListener('webglcontextrestored', contextRestoredListener);
    }
  }

  // Send final beacon
  if (batcher && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
    try {
      const payload = buildEndPayload(apiKey, sessionId, endpoint, batcher);
      navigator.sendBeacon(
        `${endpoint}/ingest/session-end`,
        JSON.stringify(payload),
      );
    } catch {
      // Fire-and-forget
    }
  }

  // Reset module state
  currentHandle = null;
  currentSessionId = null;
  collector = null;
  batcher = null;
  visibilityHandler = null;
  initComplete = false;
  eventQueue = [];
  contextLostListener = null;
  contextRestoredListener = null;
  canvasRef = null;
}

/** Builds a SessionEndPayload from the current batcher state. */
function buildEndPayload(
  apiKey: string,
  sessionId: string,
  _endpoint: string,
  bat: MetricBatcher,
): SessionEndPayload {
  return {
    apiKey,
    sessionId,
    endedAt: new Date().toISOString(),
    finalSummary: bat.getSessionSummary(),
    pendingBatches: bat.getPendingBatches(),
  };
}
