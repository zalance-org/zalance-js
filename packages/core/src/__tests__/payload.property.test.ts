import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type {
  SessionStartPayload,
  SessionEndPayload,
  MetricBatchPayload,
  EventPayload,
  GPUTier,
  DeviceFingerprint,
  SessionFinalSummary,
} from '@zalance/types';

// --- Helpers ---

/**
 * Recursively normalizes -0 to 0 in a JSON value.
 * JSON.stringify(-0) produces "0", so JSON.parse("0") gives 0 (not -0).
 * This ensures our generated values match what JSON round-trip produces.
 */
function normalizeNegativeZero(value: unknown): unknown {
  if (typeof value === 'number' && Object.is(value, -0)) return 0;
  if (Array.isArray(value)) return value.map(normalizeNegativeZero);
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = normalizeNegativeZero(v);
    }
    return result;
  }
  return value;
}

// --- Arbitraries ---

const gpuTierArb = fc.constantFrom<GPUTier>('high', 'mid', 'low', 'unknown');

// Generate ISO date strings from integer timestamps to avoid Invalid Date edge cases in fc.date()
const isoDateArb = fc
  .integer({ min: 946684800000, max: 4102444799999 }) // 2000-01-01 to 2099-12-31
  .map((ts) => new Date(ts).toISOString());

const deviceFingerprintArb: fc.Arbitrary<DeviceFingerprint> = fc.record({
  gpuRenderer: fc.string(),
  gpuVendor: fc.string(),
  webglVersion: fc.string(),
  webgpuAvailable: fc.boolean(),
  devicePixelRatio: fc.float({ min: Math.fround(0.1), max: Math.fround(10), noNaN: true }),
  screenWidth: fc.nat(),
  screenHeight: fc.nat(),
  userAgent: fc.string(),
});

const sessionFinalSummaryArb: fc.Arbitrary<SessionFinalSummary> = fc.record({
  frameCount: fc.nat(),
  fpsP50: fc.nat(),
  fpsP75: fc.nat(),
  fpsP95: fc.nat(),
  fpsP99: fc.nat(),
  longestFrameMs: fc.nat(),
  framesBelow30fps: fc.nat(),
  framesBelow15fps: fc.nat(),
  peakDrawCalls: fc.nat(),
  peakTriangles: fc.nat(),
  peakTextures: fc.nat(),
  peakGeometries: fc.nat(),
  peakPrograms: fc.nat(),
  contextLostCount: fc.nat(),
  contextRestoredCount: fc.nat(),
});

const sessionStartPayloadArb: fc.Arbitrary<SessionStartPayload> = fc.record({
  apiKey: fc.string(),
  sessionId: fc.string(),
  environment: fc.string(),
  deviceFingerprint: deviceFingerprintArb,
  gpuTier: gpuTierArb,
  startedAt: isoDateArb,
  sdkVersion: fc.string(),
});

const sessionEndPayloadArb: fc.Arbitrary<SessionEndPayload> = fc.record({
  apiKey: fc.string(),
  sessionId: fc.string(),
  endedAt: isoDateArb,
  finalSummary: sessionFinalSummaryArb,
});

const metricBatchPayloadArb: fc.Arbitrary<MetricBatchPayload> = fc.record({
  apiKey: fc.string(),
  sessionId: fc.string(),
  gpuTier: gpuTierArb,
  capturedAt: isoDateArb,
  fpsP50: fc.nat(),
  fpsP75: fc.nat(),
  fpsP95: fc.nat(),
  fpsP99: fc.nat(),
  drawCalls: fc.nat(),
  triangles: fc.nat(),
  textures: fc.nat(),
  geometries: fc.nat(),
  programs: fc.nat(),
  sdkVersion: fc.string(),
});

const eventPayloadArb: fc.Arbitrary<EventPayload> = fc.record({
  apiKey: fc.string(),
  sessionId: fc.string(),
  name: fc.string(),
  properties: fc.dictionary(fc.string(), fc.jsonValue().map(normalizeNegativeZero)),
  occurredAt: isoDateArb,
  sdkVersion: fc.string(),
});

/**
 * Property 5: Payload Serialization Round-Trip
 * Serialize to JSON via JSON.stringify(), deserialize back via JSON.parse(),
 * and assert the round-tripped object deeply equals the original.
 * **Validates: Requirements 18.4**
 */
describe('Property 5: Payload Serialization Round-Trip', () => {
  it('should round-trip SessionStartPayload through JSON serialization', () => {
    fc.assert(
      fc.property(sessionStartPayloadArb, (payload) => {
        const roundTripped = JSON.parse(JSON.stringify(payload));
        expect(roundTripped).toEqual(payload);
      }),
      { numRuns: 200 },
    );
  });

  it('should round-trip SessionEndPayload through JSON serialization', () => {
    fc.assert(
      fc.property(sessionEndPayloadArb, (payload) => {
        const roundTripped = JSON.parse(JSON.stringify(payload));
        expect(roundTripped).toEqual(payload);
      }),
      { numRuns: 200 },
    );
  });

  it('should round-trip MetricBatchPayload through JSON serialization', () => {
    fc.assert(
      fc.property(metricBatchPayloadArb, (payload) => {
        const roundTripped = JSON.parse(JSON.stringify(payload));
        expect(roundTripped).toEqual(payload);
      }),
      { numRuns: 200 },
    );
  });

  it('should round-trip EventPayload through JSON serialization', () => {
    fc.assert(
      fc.property(eventPayloadArb, (payload) => {
        const roundTripped = JSON.parse(JSON.stringify(payload));
        expect(roundTripped).toEqual(payload);
      }),
      { numRuns: 200 },
    );
  });
});
