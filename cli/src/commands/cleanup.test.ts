// cli/src/commands/cleanup.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { CleanupOptions } from "./cleanup.js";

// Mock all lib dependencies
vi.mock("../lib/validation.js", () => ({
  validateDeployEnv: vi.fn(),
  formatMissingVarsError: vi.fn((err) => `Missing: ${err.missingVars.join(", ")}`),
  DeployEnvError: class DeployEnvError extends Error {
    constructor(public missingVars: string[]) {
      super("Missing environment variables");
    }
  },
}));

vi.mock("../lib/normalize.js", () => ({
  normalizeBranch: vi.fn((branch: string) => branch.toLowerCase().replace(/[^a-z0-9-]/g, "-")),
}));

vi.mock("../lib/wif/gcp.js", () => ({
  exchangeWifToken: vi.fn(),
}));

vi.mock("../lib/pulumi.js", () => ({
  destroyApp: vi.fn(),
}));

// Import mocked modules
import { validateDeployEnv, DeployEnvError } from "../lib/validation.js";
import { normalizeBranch } from "../lib/normalize.js";
import { exchangeWifToken } from "../lib/wif/gcp.js";
import { destroyApp } from "../lib/pulumi.js";
import { cleanup } from "./cleanup.js";

const mockValidateDeployEnv = vi.mocked(validateDeployEnv);
const mockNormalizeBranch = vi.mocked(normalizeBranch);
const mockExchangeWifToken = vi.mocked(exchangeWifToken);
const mockDestroyApp = vi.mocked(destroyApp);

describe("cleanup command", () => {
  const originalEnv = process.env;
  const mockConsoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
  const mockConsoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  const mockProcessExit = vi.spyOn(process, "exit").mockImplementation(() => {
    throw new Error("process.exit called");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("GCP cleanup", () => {
    const gcpOptions: CleanupOptions = {
      cloud: "gcp",
      app: "myapp",
      branch: "feature/old-branch",
    };

    const gcpEnv = {
      GCP_PROJECT: "my-project",
      GCP_PROJECT_NUMBER: "123456789",
      GCP_REGION: "us-central1",
      STATE_BUCKET: "my-state-bucket",
      SERVICE_ACCOUNT_EMAIL: "deploy@my-project.iam.gserviceaccount.com",
      WIF_POOL_ID: "cicd-pool",
      WIF_PROVIDER_ID: "github",
      BITBUCKET_STEP_OIDC_TOKEN: "oidc-token-123",
    };

    beforeEach(() => {
      mockValidateDeployEnv.mockReturnValue(gcpEnv as any);
      mockNormalizeBranch.mockReturnValue("feature-old-branch");
      mockExchangeWifToken.mockResolvedValue("access-token-123");
      mockDestroyApp.mockResolvedValue(true);
    });

    it("validates environment first", async () => {
      await cleanup(gcpOptions);

      expect(mockValidateDeployEnv).toHaveBeenCalledWith(process.env, "gcp");
    });

    it("normalizes branch name with GCP limit (63 chars)", async () => {
      await cleanup(gcpOptions);

      expect(mockNormalizeBranch).toHaveBeenCalledWith("feature/old-branch", 63);
    });

    it("exchanges WIF token with correct parameters", async () => {
      await cleanup(gcpOptions);

      expect(mockExchangeWifToken).toHaveBeenCalledWith({
        oidcToken: "oidc-token-123",
        projectNumber: "123456789",
        poolId: "cicd-pool",
        providerId: "github",
        serviceAccountEmail: "deploy@my-project.iam.gserviceaccount.com",
      });
    });

    it("sets GCP auth environment variables", async () => {
      await cleanup(gcpOptions);

      expect(process.env.CLOUDSDK_AUTH_ACCESS_TOKEN).toBe("access-token-123");
      expect(process.env.GOOGLE_OAUTH_ACCESS_TOKEN).toBe("access-token-123");
    });

    it("destroys app with correct stack name", async () => {
      await cleanup(gcpOptions);

      expect(mockDestroyApp).toHaveBeenCalledWith(
        expect.objectContaining({
          stateBucket: "my-state-bucket",
          stackName: "organization/app/myapp-feature-old-branch",
          projectId: "my-project",
        })
      );
    });

    it("logs success when resources destroyed", async () => {
      mockDestroyApp.mockResolvedValue(true);

      await cleanup(gcpOptions);

      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("Cleanup complete")
      );
    });

    it("logs message when no resources found", async () => {
      mockDestroyApp.mockResolvedValue(false);

      await cleanup(gcpOptions);

      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("No resources found")
      );
    });

    it("uses GitHub OIDC token when Bitbucket token not available", async () => {
      delete (gcpEnv as any).BITBUCKET_STEP_OIDC_TOKEN;
      process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN = "github-oidc-token";
      mockValidateDeployEnv.mockReturnValue(gcpEnv as any);

      await cleanup(gcpOptions);

      expect(mockExchangeWifToken).toHaveBeenCalledWith(
        expect.objectContaining({
          oidcToken: "github-oidc-token",
        })
      );
    });
  });

  describe("Azure cleanup", () => {
    const azureOptions: CleanupOptions = {
      cloud: "azure",
      app: "myapp",
      branch: "feature/azure-branch",
    };

    const azureEnv = {
      AZURE_CLIENT_ID: "client-id-123",
      AZURE_TENANT_ID: "tenant-id-123",
      AZURE_SUBSCRIPTION_ID: "sub-id-123",
      AZURE_RESOURCE_GROUP: "my-rg",
      STATE_STORAGE_ACCOUNT: "mystateaccount",
      AZURE_LOCATION: "eastus",
    };

    beforeEach(() => {
      mockValidateDeployEnv.mockReturnValue(azureEnv as any);
      mockNormalizeBranch.mockReturnValue("feature-azure-branch");
      mockDestroyApp.mockResolvedValue(true);
    });

    it("validates Azure environment", async () => {
      await cleanup(azureOptions);

      expect(mockValidateDeployEnv).toHaveBeenCalledWith(process.env, "azure");
    });

    it("normalizes branch name with Azure limit (32 chars)", async () => {
      await cleanup(azureOptions);

      expect(mockNormalizeBranch).toHaveBeenCalledWith("feature/azure-branch", 32);
    });

    it("does not call WIF token exchange for Azure", async () => {
      await cleanup(azureOptions);

      expect(mockExchangeWifToken).not.toHaveBeenCalled();
    });

    it("destroys app with azure flag", async () => {
      await cleanup(azureOptions);

      expect(mockDestroyApp).toHaveBeenCalledWith(
        expect.objectContaining({
          stateBucket: "mystateaccount",
          stackName: "organization/app/myapp-feature-azure-branch",
          azure: true,
        })
      );
    });

    it("logs success when resources destroyed", async () => {
      mockDestroyApp.mockResolvedValue(true);

      await cleanup(azureOptions);

      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("Cleanup complete")
      );
    });

    it("logs message when no resources found", async () => {
      mockDestroyApp.mockResolvedValue(false);

      await cleanup(azureOptions);

      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("No resources found")
      );
    });
  });

  describe("error handling", () => {
    it("exits with error on missing environment variables", async () => {
      const error = new DeployEnvError(["GCP_PROJECT", "STATE_BUCKET"]);
      mockValidateDeployEnv.mockImplementation(() => {
        throw error;
      });

      await expect(cleanup({ cloud: "gcp", app: "myapp", branch: "main" })).rejects.toThrow(
        "process.exit called"
      );

      expect(mockConsoleError).toHaveBeenCalled();
      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });

    it("throws unexpected errors", async () => {
      mockValidateDeployEnv.mockImplementation(() => {
        throw new Error("Network failure");
      });

      await expect(cleanup({ cloud: "gcp", app: "myapp", branch: "main" })).rejects.toThrow(
        "Network failure"
      );
    });
  });
});
