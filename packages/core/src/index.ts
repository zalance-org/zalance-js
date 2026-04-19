/**
 * @zalance/core
 *
 * Framework-agnostic performance analytics SDK for Three.js and WebGPU applications.
 */

export const SDK_VERSION = '1.0.0';

export { init } from './client';
export type { ZalanceHandle } from './client';
export type {
  InitConfig,
  EventPayload,
  SessionStartPayload,
  SessionEndPayload,
  MetricBatchPayload,
  SessionFinalSummary,
  DeviceFingerprint,
  GPUTier,
} from '@zalance/types';
