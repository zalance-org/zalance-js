import type { GPUTier } from '@zalance/types';
import { getGPUTier as detectGPUTier } from 'detect-gpu';

/**
 * Maps detect-gpu tier numbers to our GPUTier string values.
 * Tier 0 = unknown, 1 = low, 2 = mid, 3 = high.
 * Any unexpected value falls back to 'unknown'.
 */
const TIER_MAP: Record<number, GPUTier> = {
  0: 'unknown',
  1: 'low',
  2: 'mid',
  3: 'high',
};

/**
 * Classifies the GPU tier using the detect-gpu library.
 *
 * This function is async and intended to be called fire-and-forget
 * from init(). It wraps detect-gpu's getGPUTier() and maps the
 * numeric tier (0-3) to our GPUTier string type.
 *
 * Falls back to 'unknown' on any error or unexpected tier value.
 *
 * @returns A promise resolving to the classified GPUTier
 */
export async function classifyGPUTier(): Promise<GPUTier> {
  try {
    const result = await detectGPUTier();
    return TIER_MAP[result.tier] ?? 'unknown';
  } catch {
    return 'unknown';
  }
}
