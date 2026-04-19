import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import type { TierResult } from 'detect-gpu';

// Mock detect-gpu before importing the module under test
vi.mock('detect-gpu', () => ({
  getGPUTier: vi.fn(),
}));

import { classifyGPUTier } from '../gpu-tier';
import { getGPUTier } from 'detect-gpu';

const mockedGetGPUTier = vi.mocked(getGPUTier);

const VALID_GPU_TIERS = ['high', 'mid', 'low', 'unknown'] as const;

/**
 * Property 6: GPU Tier Classification Determinism and Validity
 * Validates: Requirements 19.1, 19.2, 19.5
 */
describe('Property 6: GPU Tier Classification Determinism and Validity', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Determinism: For any given tier value from detect-gpu,
   * classifyGPUTier always returns the same GPUTier.
   * **Validates: Requirements 19.2**
   */
  it('should deterministically map the same tier input to the same output', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: -10, max: 10 }), async (tier) => {
        mockedGetGPUTier.mockResolvedValue({ tier, type: 'BENCHMARK' } as TierResult);

        const result1 = await classifyGPUTier();
        const result2 = await classifyGPUTier();

        expect(result1).toBe(result2);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Validity: The result is always one of 'high', 'mid', 'low', 'unknown'
   * for any arbitrary integer tier value from detect-gpu.
   * **Validates: Requirements 19.1, 19.5**
   */
  it('should always return a valid GPUTier for any integer tier value', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer(), async (tier) => {
        mockedGetGPUTier.mockResolvedValue({ tier, type: 'BENCHMARK' } as TierResult);

        const result = await classifyGPUTier();

        expect(VALID_GPU_TIERS).toContain(result);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * Completeness: All possible tier values (0, 1, 2, 3, and any unexpected value)
   * map to a valid GPUTier. Known tiers map to their specific values,
   * unexpected tiers always map to 'unknown'.
   * **Validates: Requirements 19.1, 19.2, 19.5**
   */
  it('should map known tiers to specific values and unknown tiers to unknown', async () => {
    const expectedMapping: Record<number, string> = {
      0: 'unknown',
      1: 'low',
      2: 'mid',
      3: 'high',
    };

    await fc.assert(
      fc.asyncProperty(fc.integer({ min: -100, max: 100 }), async (tier) => {
        mockedGetGPUTier.mockResolvedValue({ tier, type: 'BENCHMARK' } as TierResult);

        const result = await classifyGPUTier();

        if (tier in expectedMapping) {
          expect(result).toBe(expectedMapping[tier]);
        } else {
          expect(result).toBe('unknown');
        }
      }),
      { numRuns: 200 },
    );
  });

  /**
   * Error resilience: When detect-gpu throws any error,
   * classifyGPUTier always falls back to 'unknown'.
   * **Validates: Requirements 19.5**
   */
  it('should return unknown when detect-gpu throws any error', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string(), async (errorMessage) => {
        mockedGetGPUTier.mockRejectedValue(new Error(errorMessage));

        const result = await classifyGPUTier();

        expect(result).toBe('unknown');
      }),
      { numRuns: 100 },
    );
  });
});
