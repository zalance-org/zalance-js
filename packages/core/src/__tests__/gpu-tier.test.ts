import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TierResult } from 'detect-gpu';

// Mock detect-gpu before importing the module under test
vi.mock('detect-gpu', () => ({
  getGPUTier: vi.fn(),
}));

import { classifyGPUTier } from '../gpu-tier';
import { getGPUTier } from 'detect-gpu';

const mockedGetGPUTier = vi.mocked(getGPUTier);

describe('classifyGPUTier', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('should map tier 0 to unknown', async () => {
    mockedGetGPUTier.mockResolvedValue({ tier: 0, type: 'FALLBACK' } as TierResult);
    const result = await classifyGPUTier();
    expect(result).toBe('unknown');
  });

  it('should map tier 1 to low', async () => {
    mockedGetGPUTier.mockResolvedValue({ tier: 1, type: 'BENCHMARK' } as TierResult);
    const result = await classifyGPUTier();
    expect(result).toBe('low');
  });

  it('should map tier 2 to mid', async () => {
    mockedGetGPUTier.mockResolvedValue({ tier: 2, type: 'BENCHMARK' } as TierResult);
    const result = await classifyGPUTier();
    expect(result).toBe('mid');
  });

  it('should map tier 3 to high', async () => {
    mockedGetGPUTier.mockResolvedValue({ tier: 3, type: 'BENCHMARK' } as TierResult);
    const result = await classifyGPUTier();
    expect(result).toBe('high');
  });

  it('should fallback to unknown for unexpected tier values', async () => {
    mockedGetGPUTier.mockResolvedValue({ tier: 99, type: 'BENCHMARK' } as TierResult);
    const result = await classifyGPUTier();
    expect(result).toBe('unknown');
  });

  it('should fallback to unknown on error', async () => {
    mockedGetGPUTier.mockRejectedValue(new Error('WebGL not supported'));
    const result = await classifyGPUTier();
    expect(result).toBe('unknown');
  });

  it('should return a valid GPUTier value', async () => {
    mockedGetGPUTier.mockResolvedValue({ tier: 2, type: 'BENCHMARK' } as TierResult);
    const result = await classifyGPUTier();
    expect(['high', 'mid', 'low', 'unknown']).toContain(result);
  });
});
