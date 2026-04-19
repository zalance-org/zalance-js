import type { DeviceFingerprint } from '@zalance/types';

/**
 * Collects device fingerprint data from the renderer's WebGL context.
 *
 * Extracts GPU renderer, GPU vendor, WebGL version, WebGPU availability,
 * device pixel ratio, screen resolution, and user agent.
 *
 * @param renderer - A THREE.WebGLRenderer instance
 * @returns DeviceFingerprint with all collected device information
 */
export function collectDeviceFingerprint(renderer: unknown): DeviceFingerprint {
  const gl = getWebGLContext(renderer);

  const { gpuRenderer, gpuVendor } = getGPUInfo(gl);
  const webglVersion = getWebGLVersion(gl);
  const webgpuAvailable = getWebGPUAvailability();
  const devicePixelRatio = getDevicePixelRatio();
  const { screenWidth, screenHeight } = getScreenResolution();
  const userAgent = getUserAgent();

  return {
    gpuRenderer,
    gpuVendor,
    webglVersion,
    webgpuAvailable,
    devicePixelRatio,
    screenWidth,
    screenHeight,
    userAgent,
  };
}

/**
 * Extracts the WebGL rendering context from a THREE.WebGLRenderer.
 */
function getWebGLContext(
  renderer: unknown,
): WebGLRenderingContext | WebGL2RenderingContext {
  const r = renderer as {
    getContext(): WebGLRenderingContext | WebGL2RenderingContext;
  };
  return r.getContext();
}

/**
 * Reads GPU renderer and vendor strings via the WEBGL_debug_renderer_info extension.
 * Returns 'unknown' for both if the extension is unavailable.
 */
function getGPUInfo(gl: WebGLRenderingContext | WebGL2RenderingContext): {
  gpuRenderer: string;
  gpuVendor: string;
} {
  const UNMASKED_VENDOR_WEBGL = 0x9245;
  const UNMASKED_RENDERER_WEBGL = 0x9246;

  const ext = gl.getExtension('WEBGL_debug_renderer_info');

  if (!ext) {
    return { gpuRenderer: 'unknown', gpuVendor: 'unknown' };
  }

  const gpuRenderer =
    (gl.getParameter(UNMASKED_RENDERER_WEBGL) as string) || 'unknown';
  const gpuVendor =
    (gl.getParameter(UNMASKED_VENDOR_WEBGL) as string) || 'unknown';

  return { gpuRenderer, gpuVendor };
}

/**
 * Determines the WebGL version string from the rendering context.
 * Uses gl.getParameter(gl.VERSION) to detect the version reliably.
 */
function getWebGLVersion(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
): string {
  try {
    const version = gl.getParameter(gl.VERSION) as string;
    if (version && version.includes('WebGL 2')) {
      return 'webgl2';
    }
  } catch {
    // Fall through to default
  }
  return 'webgl';
}

/**
 * Checks if WebGPU is available via navigator.gpu.
 */
function getWebGPUAvailability(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

/**
 * Returns the device pixel ratio, defaulting to 1 if unavailable.
 */
function getDevicePixelRatio(): number {
  return typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
}

/**
 * Returns the screen resolution.
 */
function getScreenResolution(): { screenWidth: number; screenHeight: number } {
  if (typeof screen !== 'undefined') {
    return {
      screenWidth: screen.width || 0,
      screenHeight: screen.height || 0,
    };
  }
  return { screenWidth: 0, screenHeight: 0 };
}

/**
 * Returns the user agent string.
 */
function getUserAgent(): string {
  return typeof navigator !== 'undefined'
    ? navigator.userAgent || 'unknown'
    : 'unknown';
}
