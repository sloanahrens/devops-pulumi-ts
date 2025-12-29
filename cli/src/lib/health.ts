// cli/src/lib/health.ts

export interface HealthCheckParams {
  url: string;
  maxAttempts?: number;
  delayMs?: number;
  timeoutMs?: number;
}

export class HealthCheckError extends Error {
  constructor(
    public url: string,
    public attempts: number,
    public lastError?: string
  ) {
    super(`Health check failed after ${attempts} attempts: ${url}`);
    this.name = "HealthCheckError";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Perform health check with retries.
 */
export async function healthCheck(params: HealthCheckParams): Promise<boolean> {
  const {
    url,
    maxAttempts = 6,
    delayMs = 10000,
    timeoutMs = 5000,
  } = params;

  let lastError: string | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(url, {
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (response.ok) {
        console.log(`Health check passed on attempt ${attempt}/${maxAttempts}`);
        return true;
      }

      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    if (attempt < maxAttempts) {
      console.log(`Health check attempt ${attempt}/${maxAttempts} failed: ${lastError}`);
      console.log(`Retrying in ${delayMs / 1000}s...`);
      await sleep(delayMs);
    }
  }

  throw new HealthCheckError(url, maxAttempts, lastError);
}
