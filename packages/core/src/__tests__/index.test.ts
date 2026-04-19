import { describe, it, expect } from 'vitest';
import { SDK_VERSION } from '../index';

describe('@zalance/core', () => {
  it('should export SDK_VERSION', () => {
    expect(SDK_VERSION).toBe('1.0.0');
  });

  it('SDK_VERSION should be a valid semver string', () => {
    expect(SDK_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});