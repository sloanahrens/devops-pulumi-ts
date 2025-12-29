import { describe, it, expect } from "vitest";
import { validateDeployEnv, validateGcpEnv, validateAzureEnv, DeployEnvError } from "./validation.js";

describe("validateGcpEnv", () => {
  it("returns validated env when all required vars present", () => {
    const env = {
      GCP_PROJECT: "my-project",
      GCP_PROJECT_NUMBER: "123456789",
      GCP_REGION: "us-central1",
      STATE_BUCKET: "my-bucket",
      SERVICE_ACCOUNT_EMAIL: "sa@project.iam.gserviceaccount.com",
      PULUMI_CONFIG_PASSPHRASE: "secret",
      BITBUCKET_STEP_OIDC_TOKEN: "token123",
    };
    const result = validateGcpEnv(env);
    expect(result.GCP_PROJECT).toBe("my-project");
    expect(result.GCP_REGION).toBe("us-central1");
  });

  it("throws DeployEnvError with missing vars listed", () => {
    const env = {
      GCP_PROJECT: "my-project",
      // missing others
    };
    expect(() => validateGcpEnv(env)).toThrow(DeployEnvError);
    try {
      validateGcpEnv(env);
    } catch (e) {
      expect((e as DeployEnvError).missingVars).toContain("GCP_PROJECT_NUMBER");
      expect((e as DeployEnvError).missingVars).toContain("STATE_BUCKET");
      expect((e as DeployEnvError).cloud).toBe("gcp");
    }
  });

  it("uses defaults for optional vars", () => {
    const env = {
      GCP_PROJECT: "my-project",
      GCP_PROJECT_NUMBER: "123456789",
      GCP_REGION: "us-central1",
      STATE_BUCKET: "my-bucket",
      SERVICE_ACCOUNT_EMAIL: "sa@project.iam.gserviceaccount.com",
      PULUMI_CONFIG_PASSPHRASE: "secret",
      BITBUCKET_STEP_OIDC_TOKEN: "token123",
    };
    const result = validateGcpEnv(env);
    expect(result.WIF_POOL_ID).toBe("cicd-deployments");
    expect(result.WIF_PROVIDER_ID).toBe("bitbucket");
  });
});

describe("validateAzureEnv", () => {
  it("returns validated env when all required vars present", () => {
    const env = {
      AZURE_CLIENT_ID: "client-id",
      AZURE_TENANT_ID: "tenant-id",
      AZURE_SUBSCRIPTION_ID: "sub-id",
      AZURE_RESOURCE_GROUP: "rg-name",
      STATE_STORAGE_ACCOUNT: "storageacct",
      PULUMI_CONFIG_PASSPHRASE: "secret",
      BITBUCKET_STEP_OIDC_TOKEN: "token123",
    };
    const result = validateAzureEnv(env);
    expect(result.AZURE_CLIENT_ID).toBe("client-id");
    expect(result.AZURE_RESOURCE_GROUP).toBe("rg-name");
  });

  it("throws DeployEnvError with missing vars listed", () => {
    const env = {
      AZURE_CLIENT_ID: "client-id",
      // missing others
    };
    expect(() => validateAzureEnv(env)).toThrow(DeployEnvError);
    try {
      validateAzureEnv(env);
    } catch (e) {
      expect((e as DeployEnvError).missingVars).toContain("AZURE_TENANT_ID");
      expect((e as DeployEnvError).missingVars).toContain("STATE_STORAGE_ACCOUNT");
      expect((e as DeployEnvError).cloud).toBe("azure");
    }
  });

  it("uses defaults for optional vars", () => {
    const env = {
      AZURE_CLIENT_ID: "client-id",
      AZURE_TENANT_ID: "tenant-id",
      AZURE_SUBSCRIPTION_ID: "sub-id",
      AZURE_RESOURCE_GROUP: "rg-name",
      STATE_STORAGE_ACCOUNT: "storageacct",
      PULUMI_CONFIG_PASSPHRASE: "secret",
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: "token123",
    };
    const result = validateAzureEnv(env);
    expect(result.AZURE_LOCATION).toBe("eastus");
  });
});

describe("validateDeployEnv", () => {
  it("calls validateGcpEnv when cloud is gcp", () => {
    const env = {
      GCP_PROJECT: "my-project",
      GCP_PROJECT_NUMBER: "123456789",
      GCP_REGION: "us-central1",
      STATE_BUCKET: "my-bucket",
      SERVICE_ACCOUNT_EMAIL: "sa@project.iam.gserviceaccount.com",
      PULUMI_CONFIG_PASSPHRASE: "secret",
      BITBUCKET_STEP_OIDC_TOKEN: "token123",
    };
    const result = validateDeployEnv(env, "gcp");
    expect("GCP_PROJECT" in result).toBe(true);
  });

  it("calls validateAzureEnv when cloud is azure", () => {
    const env = {
      AZURE_CLIENT_ID: "client-id",
      AZURE_TENANT_ID: "tenant-id",
      AZURE_SUBSCRIPTION_ID: "sub-id",
      AZURE_RESOURCE_GROUP: "rg-name",
      STATE_STORAGE_ACCOUNT: "storageacct",
      PULUMI_CONFIG_PASSPHRASE: "secret",
      BITBUCKET_STEP_OIDC_TOKEN: "token123",
    };
    const result = validateDeployEnv(env, "azure");
    expect("AZURE_CLIENT_ID" in result).toBe(true);
  });
});
