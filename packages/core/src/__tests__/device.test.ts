import { describe, it, expect, vi, beforeEach } from 'vitest';
import { collectDeviceFingerprint } from '../device';

/**
 * Creates a mock WebGL rendering context with configurable extension support.
 */
function createMockGLContext(
  options: {
    hasDebugInfo?: boolean;
    gpuRenderer?: string;
    gpuVendor?: string;
    versionString?: string;
  } = {},
) {
  const {
    hasDebugInfo = true,
    gpuRenderer = 'ANGLE (NVIDIA GeForce RTX 3080)',
    gpuVendor = 'Google Inc. (NVIDIA)',
    versionString = 'WebGL 2.0 (OpenGL ES 3.0 Chromium)',
  } = options;

  const UNMASKED_VENDOR_WEBGL = 0x9245;
  const UNMASKED_RENDERER_WEBGL = 0x9246;
  // gl.VERSION constant value
  const GL_VERSION = 0x1f02;

  const gl = {
    VERSION: GL_VERSION,
    getExtension: vi.fn((name: string) => {
      if (name === 'WEBGL_debug_renderer_info' && hasDebugInfo) {
        return {}; // non-null means extension is available
      }
      return null;
    }),
    getParameter: vi.fn((param: number) => {
      if (param === UNMASKED_RENDERER_WEBGL) return gpuRenderer;
      if (param === UNMASKED_VENDOR_WEBGL) return gpuVendor;
      if (param === GL_VERSION) return versionString;
      return null;
    }),
  };

  return gl;
}

/**
 * Creates a mock THREE.WebGLRenderer.
 */
function createMockRenderer(glContext: unknown) {
  return {
    getContext: () => glContext,
  };
}

describe('collectDeviceFingerprint', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('should collect all device fingerprint fields', () => {
    const gl = createMockGLContext();
    const renderer = createMockRenderer(gl);

    const fingerprint = collectDeviceFingerprint(renderer);

    expect(fingerprint).toHaveProperty('gpuRenderer');
    expect(fingerprint).toHaveProperty('gpuVendor');
    expect(fingerprint).toHaveProperty('webglVersion');
    expect(fingerprint).toHaveProperty('webgpuAvailable');
    expect(fingerprint).toHaveProperty('devicePixelRatio');
    expect(fingerprint).toHaveProperty('screenWidth');
    expect(fingerprint).toHaveProperty('screenHeight');
    expect(fingerprint).toHaveProperty('userAgent');
  });

  it('should extract GPU renderer and vendor from WebGL context', () => {
    const gl = createMockGLContext({
      gpuRenderer: 'ANGLE (NVIDIA GeForce RTX 4090)',
      gpuVendor: 'Google Inc. (NVIDIA)',
    });
    const renderer = createMockRenderer(gl);

    const fingerprint = collectDeviceFingerprint(renderer);

    expect(fingerprint.gpuRenderer).toBe('ANGLE (NVIDIA GeForce RTX 4090)');
    expect(fingerprint.gpuVendor).toBe('Google Inc. (NVIDIA)');
  });

  it('should return "unknown" for GPU info when WEBGL_debug_renderer_info is unavailable', () => {
    const gl = createMockGLContext({ hasDebugInfo: false });
    const renderer = createMockRenderer(gl);

    const fingerprint = collectDeviceFingerprint(renderer);

    expect(fingerprint.gpuRenderer).toBe('unknown');
    expect(fingerprint.gpuVendor).toBe('unknown');
  });

  it('should detect WebGL2 context via VERSION string', () => {
    const gl = createMockGLContext({
      versionString: 'WebGL 2.0 (OpenGL ES 3.0 Chromium)',
    });
    const renderer = createMockRenderer(gl);

    const fingerprint = collectDeviceFingerprint(renderer);

    expect(fingerprint.webglVersion).toBe('webgl2');
  });

  it('should detect WebGL1 context via VERSION string', () => {
    const gl = createMockGLContext({
      versionString: 'WebGL 1.0 (OpenGL ES 2.0 Chromium)',
    });
    const renderer = createMockRenderer(gl);

    const fingerprint = collectDeviceFingerprint(renderer);

    expect(fingerprint.webglVersion).toBe('webgl');
  });

  it('should detect WebGPU availability', () => {
    const fingerprint = collectDeviceFingerprint(
      createMockRenderer(createMockGLContext()),
    );

    // jsdom doesn't have navigator.gpu, so this should be false
    expect(fingerprint.webgpuAvailable).toBe(false);
  });

  it('should collect device pixel ratio', () => {
    const fingerprint = collectDeviceFingerprint(
      createMockRenderer(createMockGLContext()),
    );

    expect(typeof fingerprint.devicePixelRatio).toBe('number');
    expect(fingerprint.devicePixelRatio).toBeGreaterThan(0);
  });

  it('should collect screen resolution', () => {
    const fingerprint = collectDeviceFingerprint(
      createMockRenderer(createMockGLContext()),
    );

    expect(typeof fingerprint.screenWidth).toBe('number');
    expect(typeof fingerprint.screenHeight).toBe('number');
  });

  it('should collect user agent string', () => {
    const fingerprint = collectDeviceFingerprint(
      createMockRenderer(createMockGLContext()),
    );

    expect(typeof fingerprint.userAgent).toBe('string');
    expect(fingerprint.userAgent.length).toBeGreaterThan(0);
  });

  it('should call getExtension with WEBGL_debug_renderer_info', () => {
    const gl = createMockGLContext();
    const renderer = createMockRenderer(gl);

    collectDeviceFingerprint(renderer);

    expect(gl.getExtension).toHaveBeenCalledWith('WEBGL_debug_renderer_info');
  });

  it('should not call getParameter for GPU info when extension is missing', () => {
    const gl = createMockGLContext({ hasDebugInfo: false });
    const renderer = createMockRenderer(gl);

    collectDeviceFingerprint(renderer);

    // getParameter is still called for VERSION, but not for GPU info constants
    const calls = gl.getParameter.mock.calls;
    const gpuInfoCalls = calls.filter(
      ([param]: [number]) => param === 0x9245 || param === 0x9246,
    );
    expect(gpuInfoCalls).toHaveLength(0);
  });
});
