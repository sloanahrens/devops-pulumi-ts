// cli/src/lib/health.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { healthCheck, HealthCheckError } from "./health.js";

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("healthCheck", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns true on immediate success", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });

    const promise = healthCheck({ url: "https://app.run.app/health" });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("retries on failure and succeeds", async () => {
    mockFetch
      .mockRejectedValueOnce(new Error("network"))
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce({ ok: true });

    const promise = healthCheck({
      url: "https://app.run.app/health",
      maxAttempts: 5,
      delayMs: 100,
    });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("throws HealthCheckError after max attempts", async () => {
    mockFetch.mockRejectedValue(new Error("network"));

    const promise = healthCheck({
      url: "https://app.run.app/health",
      maxAttempts: 3,
      delayMs: 100,
    });

    // Attach catch handler before running timers to avoid unhandled rejection
    const resultPromise = promise.catch((e) => e);
    await vi.runAllTimersAsync();
    const error = await resultPromise;

    expect(error).toBeInstanceOf(HealthCheckError);
    expect(error.url).toBe("https://app.run.app/health");
    expect(error.attempts).toBe(3);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });
});
