/**
 * @zalance/r3f
 *
 * React Three Fiber integration for Zalance performance analytics SDK.
 * Drop-in <PerformanceMonitor> component that wires Zalance into your R3F canvas.
 */

import { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import { init } from '@zalance/core';
import type { ZalanceHandle } from '@zalance/core';

export interface PerformanceMonitorProps {
  /** Your Zalance project API key (required). */
  apiKey: string;
  /** Free-form environment tag, e.g. "production", "staging". */
  environment?: string;
  /** Custom ingest endpoint URL. Defaults to https://api.zalance.dev. */
  endpoint?: string;
}

/**
 * Drop-in R3F component that initializes Zalance performance monitoring.
 *
 * Place inside your `<Canvas>` — it renders nothing visually.
 *
 * ```tsx
 * <Canvas>
 *   <PerformanceMonitor apiKey="proj_abc123" />
 *   <YourScene />
 * </Canvas>
 * ```
 */
export function PerformanceMonitor({
  apiKey,
  environment,
  endpoint,
}: PerformanceMonitorProps): null {
  const gl = useThree((state) => state.gl);
  const handleRef = useRef<ZalanceHandle | null>(null);

  useEffect(() => {
    const handle = init({
      apiKey,
      renderer: gl,
      environment,
      endpoint,
    });
    handleRef.current = handle;

    return () => {
      handle.stop();
      handleRef.current = null;
    };
  }, [gl, apiKey, environment, endpoint]);

  return null;
}

// Re-exports from @zalance/core
export { init, SDK_VERSION } from '@zalance/core';
export type {
  ZalanceHandle,
  InitConfig,
  EventPayload,
  SessionStartPayload,
  SessionEndPayload,
  MetricBatchPayload,
  SessionFinalSummary,
  DeviceFingerprint,
  GPUTier,
} from '@zalance/core';
