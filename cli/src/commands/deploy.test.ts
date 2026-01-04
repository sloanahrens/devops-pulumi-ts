// cli/src/commands/deploy.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { DeployOptions } from "./deploy.js";

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

vi.mock("../lib/docker.js", () => ({
  dockerLogin: vi.fn(),
  dockerBuild: vi.fn(),
  dockerPush: vi.fn(),
  dockerPull: vi.fn(),
}));

vi.mock("../lib/pulumi.js", () => ({
  getInfraOutputs: vi.fn(),
  deployApp: vi.fn(),
}));

vi.mock("../lib/health.js", () => ({
  healthCheck: vi.fn(),
}));

// Mock fs for service URL file write
vi.mock("fs", () => ({
  default: {
    writeFileSync: vi.fn(),
  },
}));

// Import mocked modules
import { validateDeployEnv, DeployEnvError } from "../lib/validation.js";
import { normalizeBranch } from "../lib/normalize.js";
import { exchangeWifToken } from "../lib/wif/gcp.js";
import { dockerLogin, dockerBuild, dockerPush, dockerPull } from "../lib/docker.js";
import { getInfraOutputs, deployApp } from "../lib/pulumi.js";
import { healthCheck } from "../lib/health.js";
import fs from "fs";
import { deploy } from "./deploy.js";

const mockValidateDeployEnv = vi.mocked(validateDeployEnv);
const mockNormalizeBranch = vi.mocked(normalizeBranch);
const mockExchangeWifToken = vi.mocked(exchangeWifToken);
const mockDockerLogin = vi.mocked(dockerLogin);
const mockDockerBuild = vi.mocked(dockerBuild);
const mockDockerPush = vi.mocked(dockerPush);
const mockDockerPull = vi.mocked(dockerPull);
const mockGetInfraOutputs = vi.mocked(getInfraOutputs);
const mockDeployApp = vi.mocked(deployApp);
const mockHealthCheck = vi.mocked(healthCheck);
const mockWriteFileSync = vi.mocked(fs.writeFileSync);

describe("deploy command", () => {
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

  describe("GCP deployment", () => {
    const gcpOptions: DeployOptions = {
      cloud: "gcp",
      app: "myapp",
      branch: "feature/test-branch",
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
      mockNormalizeBranch.mockReturnValue("feature-test-branch");
      mockExchangeWifToken.mockResolvedValue("access-token-123");
      mockGetInfraOutputs.mockResolvedValue({
        registryUrl: "us-central1-docker.pkg.dev/my-project/apps-docker",
        projectId: "my-project",
        region: "us-central1",
      });
      mockDockerPull.mockResolvedValue(true);
      mockDockerLogin.mockResolvedValue();
      mockDockerBuild.mockResolvedValue();
      mockDockerPush.mockResolvedValue();
      mockDeployApp.mockResolvedValue({ url: "https://myapp-feature-test-branch-abc123.run.app" });
      mockHealthCheck.mockResolvedValue();
    });

    it("validates environment first", async () => {
      await deploy(gcpOptions);

      expect(mockValidateDeployEnv).toHaveBeenCalledWith(process.env, "gcp");
    });

    it("normalizes branch name with GCP limit (63 chars)", async () => {
      await deploy(gcpOptions);

      expect(mockNormalizeBranch).toHaveBeenCalledWith("feature/test-branch", 63);
    });

    it("exchanges WIF token with correct parameters", async () => {
      await deploy(gcpOptions);

      expect(mockExchangeWifToken).toHaveBeenCalledWith({
        oidcToken: "oidc-token-123",
        projectNumber: "123456789",
        poolId: "cicd-pool",
        providerId: "github",
        serviceAccountEmail: "deploy@my-project.iam.gserviceaccount.com",
      });
    });

    it("sets GCP auth environment variables", async () => {
      await deploy(gcpOptions);

      expect(process.env.CLOUDSDK_AUTH_ACCESS_TOKEN).toBe("access-token-123");
      expect(process.env.GOOGLE_OAUTH_ACCESS_TOKEN).toBe("access-token-123");
    });

    it("gets infrastructure outputs", async () => {
      await deploy(gcpOptions);

      expect(mockGetInfraOutputs).toHaveBeenCalledWith(
        expect.objectContaining({
          stateBucket: "my-state-bucket",
          infraStackRef: "organization/infrastructure/prod",
        })
      );
    });

    it("logs into Docker registry", async () => {
      await deploy(gcpOptions);

      expect(mockDockerLogin).toHaveBeenCalledWith({
        registry: "us-central1-docker.pkg.dev",
        accessToken: "access-token-123",
      });
    });

    it("pulls existing image for cache", async () => {
      await deploy(gcpOptions);

      expect(mockDockerPull).toHaveBeenCalledWith(
        "us-central1-docker.pkg.dev/my-project/apps-docker/myapp:feature-test-branch"
      );
    });

    it("builds Docker image with cache when available", async () => {
      await deploy(gcpOptions);

      expect(mockDockerBuild).toHaveBeenCalledWith(
        expect.objectContaining({
          imageName: "us-central1-docker.pkg.dev/my-project/apps-docker/myapp:feature-test-branch",
          cacheFrom: "us-central1-docker.pkg.dev/my-project/apps-docker/myapp:feature-test-branch",
        })
      );
    });

    it("builds without cache when no existing image", async () => {
      mockDockerPull.mockResolvedValue(false);

      await deploy(gcpOptions);

      expect(mockDockerBuild).toHaveBeenCalledWith(
        expect.objectContaining({
          cacheFrom: undefined,
        })
      );
    });

    it("pushes Docker image", async () => {
      await deploy(gcpOptions);

      expect(mockDockerPush).toHaveBeenCalledWith(
        "us-central1-docker.pkg.dev/my-project/apps-docker/myapp:feature-test-branch"
      );
    });

    it("deploys app via Pulumi with correct config", async () => {
      await deploy(gcpOptions);

      expect(mockDeployApp).toHaveBeenCalledWith(
        expect.objectContaining({
          stateBucket: "my-state-bucket",
          stackName: "organization/app/myapp-feature-test-branch",
          config: expect.objectContaining({
            "gcp:project": "my-project",
            appName: "myapp",
            imageTag: "feature-test-branch",
            region: "us-central1",
          }),
        })
      );
    });

    it("runs health check on deployed URL", async () => {
      await deploy(gcpOptions);

      expect(mockHealthCheck).toHaveBeenCalledWith({
        url: "https://myapp-feature-test-branch-abc123.run.app/health",
      });
    });

    it("writes service URL to file", async () => {
      await deploy(gcpOptions);

      expect(mockWriteFileSync).toHaveBeenCalledWith(
        "/tmp/service-url.txt",
        "https://myapp-feature-test-branch-abc123.run.app"
      );
    });

    it("applies custom port when specified", async () => {
      await deploy({ ...gcpOptions, port: 3000 });

      expect(mockDeployApp).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            containerPort: "3000",
          }),
        })
      );
    });

    it("applies custom memory when specified", async () => {
      await deploy({ ...gcpOptions, memory: "1Gi" });

      expect(mockDeployApp).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            memoryLimit: "1Gi",
          }),
        })
      );
    });

    it("sets private access when specified", async () => {
      await deploy({ ...gcpOptions, private: true });

      expect(mockDeployApp).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            allowUnauthenticated: "false",
          }),
        })
      );
    });

    it("passes build args from environment", async () => {
      process.env.API_KEY = "secret-key";
      process.env.DEBUG = "true";

      await deploy({ ...gcpOptions, buildArgsFromEnv: "API_KEY,DEBUG" });

      expect(mockDockerBuild).toHaveBeenCalledWith(
        expect.objectContaining({
          buildArgs: { API_KEY: "secret-key", DEBUG: "true" },
        })
      );
    });
  });

  describe("Azure deployment", () => {
    const azureOptions: DeployOptions = {
      cloud: "azure",
      app: "myapp",
      branch: "main",
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
      mockNormalizeBranch.mockReturnValue("main");
      mockGetInfraOutputs.mockResolvedValue({
        registryUrl: "myacr.azurecr.io",
        projectId: undefined,
        region: undefined,
      });
      mockDockerPull.mockResolvedValue(false);
      mockDockerLogin.mockResolvedValue();
      mockDockerBuild.mockResolvedValue();
      mockDockerPush.mockResolvedValue();
      mockDeployApp.mockResolvedValue({ url: "https://myapp-main.azurecontainerapps.io" });
      mockHealthCheck.mockResolvedValue();
    });

    it("validates Azure environment", async () => {
      await deploy(azureOptions);

      expect(mockValidateDeployEnv).toHaveBeenCalledWith(process.env, "azure");
    });

    it("normalizes branch name with Azure limit (32 chars)", async () => {
      await deploy(azureOptions);

      expect(mockNormalizeBranch).toHaveBeenCalledWith("main", 32);
    });

    it("does not call WIF token exchange for Azure", async () => {
      await deploy(azureOptions);

      expect(mockExchangeWifToken).not.toHaveBeenCalled();
    });

    it("gets infrastructure outputs with azure flag", async () => {
      await deploy(azureOptions);

      expect(mockGetInfraOutputs).toHaveBeenCalledWith(
        expect.objectContaining({
          azure: true,
        })
      );
    });

    it("logs into Docker with azure flag", async () => {
      await deploy(azureOptions);

      expect(mockDockerLogin).toHaveBeenCalledWith({
        registry: "myacr.azurecr.io",
        azure: true,
      });
    });

    it("deploys app with azure flag", async () => {
      await deploy(azureOptions);

      expect(mockDeployApp).toHaveBeenCalledWith(
        expect.objectContaining({
          azure: true,
        })
      );
    });

    it("uses Azure default memory (2Gi)", async () => {
      await deploy(azureOptions);

      expect(mockDeployApp).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            memoryLimit: "2Gi",
          }),
        })
      );
    });
  });

  describe("error handling", () => {
    it("exits with error on missing environment variables", async () => {
      const error = new DeployEnvError(["GCP_PROJECT", "STATE_BUCKET"]);
      mockValidateDeployEnv.mockImplementation(() => {
        throw error;
      });

      await expect(deploy({ cloud: "gcp", app: "myapp", branch: "main" })).rejects.toThrow(
        "process.exit called"
      );

      expect(mockConsoleError).toHaveBeenCalled();
      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });

    it("throws unexpected errors", async () => {
      mockValidateDeployEnv.mockImplementation(() => {
        throw new Error("Unexpected error");
      });

      await expect(deploy({ cloud: "gcp", app: "myapp", branch: "main" })).rejects.toThrow(
        "Unexpected error"
      );
    });
  });
});
