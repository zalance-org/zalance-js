import type { SessionEndPayload } from '@zalance/types';
import type { FrameCollector } from './collector';
import type { MetricBatcher } from './batcher';

export interface VisibilityHandlerConfig {
  endpoint: string;
  collector: FrameCollector;
  batcher: MetricBatcher;
  buildEndPayload: () => SessionEndPayload;
}

/**
 * Manages page visibility lifecycle for the SDK.
 *
 * - Pauses frame sampling when the tab is hidden
 * - Resumes sampling when the tab becomes visible again
 * - Fires a sendBeacon with session-end data on pagehide / visibilitychange to hidden
 */
export class VisibilityHandler {
  private readonly endpoint: string;
  private readonly collector: FrameCollector;
  private readonly batcher: MetricBatcher;
  private readonly buildEndPayload: () => SessionEndPayload;

  private readonly onVisibilityChange = (): void => {
    if (document.visibilityState === 'hidden') {
      this.collector.pause();
      this.sendEndBeacon();
    } else if (document.visibilityState === 'visible') {
      this.collector.resume();
    }
  };

  private readonly onPageHide = (): void => {
    this.sendEndBeacon();
  };

  constructor(config: VisibilityHandlerConfig) {
    this.endpoint = config.endpoint;
    this.collector = config.collector;
    this.batcher = config.batcher;
    this.buildEndPayload = config.buildEndPayload;
  }

  /** Registers visibilitychange and pagehide event listeners on document. */
  attach(): void {
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    window.addEventListener('pagehide', this.onPageHide);
  }

  /** Removes the event listeners (for cleanup on stop()). */
  detach(): void {
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    window.removeEventListener('pagehide', this.onPageHide);
  }

  /** Builds the session-end payload and sends it via sendBeacon. */
  private sendEndBeacon(): void {
    if (typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') {
      return;
    }

    try {
      const payload = this.buildEndPayload();
      const url = `${this.endpoint}/ingest/session-end`;
      navigator.sendBeacon(url, JSON.stringify(payload));
    } catch {
      // Fire-and-forget — silently discard errors
    }
  }
}
