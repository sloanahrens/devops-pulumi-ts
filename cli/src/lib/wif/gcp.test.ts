// cli/src/lib/wif/gcp.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { exchangeWifToken, WifTokenError } from "./gcp.js";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("exchangeWifToken", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("exchanges OIDC token for GCP access token", async () => {
    // Mock STS response
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: "sts-token-123" }),
    });
    // Mock IAM credentials response
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ accessToken: "gcp-access-token-456" }),
    });

    const result = await exchangeWifToken({
      oidcToken: "bitbucket-oidc-token",
      projectNumber: "123456789",
      poolId: "cicd-deployments",
      providerId: "bitbucket",
      serviceAccountEmail: "deploy@project.iam.gserviceaccount.com",
    });

    expect(result).toBe("gcp-access-token-456");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("throws WifTokenError on STS failure", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => "Invalid token",
    });

    await expect(
      exchangeWifToken({
        oidcToken: "bad-token",
        projectNumber: "123456789",
        poolId: "cicd-deployments",
        providerId: "bitbucket",
        serviceAccountEmail: "deploy@project.iam.gserviceaccount.com",
      })
    ).rejects.toThrow(WifTokenError);
  });

  it("throws WifTokenError on IAM credentials failure", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: "sts-token" }),
    });
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: async () => "Permission denied",
    });

    await expect(
      exchangeWifToken({
        oidcToken: "valid-oidc",
        projectNumber: "123456789",
        poolId: "cicd-deployments",
        providerId: "bitbucket",
        serviceAccountEmail: "deploy@project.iam.gserviceaccount.com",
      })
    ).rejects.toThrow(WifTokenError);
  });
});
