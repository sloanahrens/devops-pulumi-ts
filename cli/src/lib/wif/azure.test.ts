// cli/src/lib/wif/azure.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  validateAzureEnvironment,
  setupAzureAuth,
  AzureWifError,
} from "./azure.js";

describe("validateAzureEnvironment", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns config when all Azure vars and GitHub OIDC token present", () => {
    process.env.AZURE_CLIENT_ID = "client-123";
    process.env.AZURE_TENANT_ID = "tenant-456";
    process.env.AZURE_SUBSCRIPTION_ID = "sub-789";
    process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN = "github-oidc-token";

    const config = validateAzureEnvironment();

    expect(config).toEqual({
      clientId: "client-123",
      tenantId: "tenant-456",
      subscriptionId: "sub-789",
    });
  });

  it("returns config when all Azure vars and Bitbucket OIDC token present", () => {
    process.env.AZURE_CLIENT_ID = "client-123";
    process.env.AZURE_TENANT_ID = "tenant-456";
    process.env.AZURE_SUBSCRIPTION_ID = "sub-789";
    process.env.BITBUCKET_STEP_OIDC_TOKEN = "bitbucket-oidc-token";

    const config = validateAzureEnvironment();

    expect(config).toEqual({
      clientId: "client-123",
      tenantId: "tenant-456",
      subscriptionId: "sub-789",
    });
  });

  it("throws AzureWifError when AZURE_CLIENT_ID is missing", () => {
    process.env.AZURE_TENANT_ID = "tenant-456";
    process.env.AZURE_SUBSCRIPTION_ID = "sub-789";
    process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN = "token";

    expect(() => validateAzureEnvironment()).toThrow(AzureWifError);
    expect(() => validateAzureEnvironment()).toThrow(/AZURE_CLIENT_ID/);
  });

  it("throws AzureWifError listing all missing vars", () => {
    process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN = "token";

    try {
      validateAzureEnvironment();
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AzureWifError);
      const error = err as AzureWifError;
      expect(error.step).toBe("validation");
      expect(error.message).toContain("AZURE_CLIENT_ID");
      expect(error.message).toContain("AZURE_TENANT_ID");
      expect(error.message).toContain("AZURE_SUBSCRIPTION_ID");
    }
  });

  it("throws AzureWifError when no OIDC token available", () => {
    process.env.AZURE_CLIENT_ID = "client-123";
    process.env.AZURE_TENANT_ID = "tenant-456";
    process.env.AZURE_SUBSCRIPTION_ID = "sub-789";
    // No OIDC tokens set

    try {
      validateAzureEnvironment();
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AzureWifError);
      const error = err as AzureWifError;
      expect(error.step).toBe("token_request");
      expect(error.message).toContain("No OIDC token available");
    }
  });
});

describe("setupAzureAuth", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns config on successful setup", async () => {
    process.env.AZURE_CLIENT_ID = "client-123";
    process.env.AZURE_TENANT_ID = "tenant-456";
    process.env.AZURE_SUBSCRIPTION_ID = "sub-789";
    process.env.BITBUCKET_STEP_OIDC_TOKEN = "oidc-token";

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const config = await setupAzureAuth();

    expect(config).toEqual({
      clientId: "client-123",
      tenantId: "tenant-456",
      subscriptionId: "sub-789",
    });
    expect(consoleSpy).toHaveBeenCalledWith(
      "Azure OIDC configured for tenant tenant-456"
    );

    consoleSpy.mockRestore();
  });

  it("throws when validation fails", async () => {
    // Missing all Azure vars
    process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN = "token";

    await expect(setupAzureAuth()).rejects.toThrow(AzureWifError);
  });
});
