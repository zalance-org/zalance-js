# @zalance/core

Production performance analytics for Three.js. Real GPU metrics from real users.

Your Three.js site runs at 60fps on your M2 Mac. But 25% of your visitors are on integrated Intel GPUs where it drops to 8fps, draw calls spike, and textures exhaust VRAM. Sentry won't tell you. Datadog won't tell you. They measure DOM — not WebGL.

Zalance captures what standard RUM tools can't: GPU identity, frame rate distributions, draw call counts, texture memory, and WebGL/WebGPU context events — from every visitor, on every device, in production.

## Install

```bash
npm install @zalance/core
```

## Quick start

```typescript
import { init } from '@zalance/core';

init({
  apiKey: 'proj_abc123',
  renderer: myThreeRenderer, // your THREE.WebGLRenderer instance
});
```

That's it. Data appears in your [dashboard](https://app.zalance.io) within 30 seconds.

### React Three Fiber

```bash
npm install @zalance/r3f
```

```tsx
import { PerformanceMonitor } from '@zalance/r3f';

<Canvas>
  <PerformanceMonitor apiKey="proj_abc123" />
  <YourScene />
</Canvas>
```

## What it captures

**Device identity** — GPU vendor and model via `WEBGL_debug_renderer_info`, device memory, CPU cores, viewport, pixel ratio, WebGPU availability. The fields that let you segment your audience by hardware capability.

**Frame rate distribution** — Not a single FPS number. p50, p95, p99, longest frame, count of frames below 30fps, count below 15fps. Sampled every frame, aggregated every 10 seconds, computed over a rolling 5-second window.

**Scene characteristics** — Draw calls, triangle count, geometry count, texture count, shader program count. Read directly from `renderer.info` on every batch interval. When these spike after a deploy, you see it.

**Lifecycle events** — WebGL context loss, context restore, shader compilation errors. The catastrophic failures that silently kill sessions on weak hardware.

**Session metadata** — Browser, OS, screen resolution, pixel ratio, WebGL version. Combined with GPU identity, this gives you a complete picture of every visitor's rendering environment.

## What it doesn't capture

No DOM snapshots. No session replay. No user identity. No cookies. No localStorage. No PII of any kind. Zalance captures rendering performance data and device capabilities — nothing else.

## Configuration

```typescript
init({
  apiKey: 'proj_abc123',          // Required. From your dashboard.
  renderer: myRenderer,           // Required. Your THREE.WebGLRenderer.
  environment: 'production',      // Optional. Free-form tag for filtering.
  sampleRate: 1.0,                // Optional. 0.0–1.0. Fraction of sessions to track.
  endpoint: 'https://api.zalance.io', // Optional. Override for self-hosting.
  debug: false,                   // Optional. Show stats overlay in browser.
});
```

The `init` function returns a handle:

```typescript
const handle = init({ ... });

// Later, to stop tracking (e.g., on unmount):
handle.stop();
```

## How it works

The SDK hooks into `requestAnimationFrame` and reads `renderer.info` values on each frame. It does not monkey-patch, wrap, or modify your Three.js renderer in any way. Your render loop is untouched.

Frame timings are collected into a rolling window. Every 10 seconds, the SDK computes percentile statistics from that window, reads the current scene characteristics from `renderer.info`, packages it into a batch, and POSTs it to `api.zalance.io`. Batches are buffered in memory and flushed with retries on failure.

On page unload, the SDK flushes remaining data via `navigator.sendBeacon` so nothing is lost when users navigate away.

Background tabs are handled correctly — frames are not counted while `document.visibilityState` is not `'visible'`, preventing artificial frame time inflation from throttled background tabs.

### Size

Under 10KB gzipped. No dependencies other than the types from Three.js.

### Performance overhead

Negligible. The SDK reads `renderer.info` (which Three.js already computes) and calls `performance.now()` once per frame. The percentile computation runs once per batch interval (every 10 seconds), not per frame. Network requests are batched and sent asynchronously. The SDK does not allocate GPU resources, create textures, or issue draw calls.

## Dashboard

Your data flows to [app.zalance.io](https://app.zalance.io) where you get:

- **Device cohort breakdown** — What fraction of your visitors are on Intel integrated vs. Apple M-series vs. discrete NVIDIA? What's their median FPS?
- **FPS distribution** — Histogram of p50/p95/p99 across all sessions, segmented by GPU tier.
- **Scene characteristics over time** — Draw calls, triangles, texture memory across deploys. Spot regressions instantly.
- **Session drill-down** — Click into any session to see FPS over time, device info, and events.

Free tier: 10k sessions/month. No credit card required.

## Compatibility

- Three.js r150+ (WebGLRenderer)
- Three.js r171+ (WebGPURenderer — experimental)
- All major browsers: Chrome, Firefox, Safari, Edge
- Works with vanilla Three.js, React Three Fiber, and any framework that uses a standard Three.js renderer

The SDK gracefully handles environments where `WEBGL_debug_renderer_info` is blocked (e.g., Firefox with Resist Fingerprinting) — GPU fields are recorded as `'unknown'` and everything else continues to work.

## Privacy

Zalance does not collect personal data. No IP addresses are stored. No cookies are set. No user identifiers are tracked. The data model is: device capabilities + rendering performance + scene characteristics. That's it.

If you need to comply with GDPR or similar, the SDK's data collection falls under "legitimate interest" for service quality monitoring since it contains no PII. Consult your own legal counsel for your specific situation.

## Self-hosting

The SDK's `endpoint` option points to `api.zalance.io` by default. If you want to send data to your own infrastructure, override it:

```typescript
init({
  apiKey: 'your-key',
  renderer: myRenderer,
  endpoint: 'https://your-ingest-server.com',
});
```

The SDK is MIT-licensed. The ingest server and dashboard are source-available at [github.com/zalance/zalance](https://github.com/zalance-org/zalance).

## Contributing

Issues and PRs welcome. The SDK lives in `packages/sdk-core/` in the [Zalance monorepo](https://github.com/zalance-org/zalance).

```bash
git clone https://github.com/zalance-org/zalance.git
cd zalance
pnpm install
pnpm --filter @zalance/core dev
```

To run the SDK against a local Three.js scene during development, use the `debug: true` option to see a stats overlay in the browser.

## License

MIT — see [LICENSE](./LICENSE).