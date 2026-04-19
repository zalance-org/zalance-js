export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function postWithRetry(
  url: string,
  body: unknown,
  maxRetries = 3,
): Promise<Response | null> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (response.ok) return response;

      // Don't retry on 4xx client errors
      if (response.status >= 400 && response.status < 500) {
        return response;
      }

      lastError = new Error("HTTP " + response.status);
    } catch (error) {
      lastError = error as Error;
    }

    // Exponential backoff: 1s, 2s, 4s
    if (attempt < maxRetries - 1) {
      await sleep(Math.pow(2, attempt) * 1000);
    }
  }

  // Discard on final failure - return null so caller can silently drop
  return null;
}
