import { describe, it, expect } from "vitest";
import { validateDeployEnv, DeployEnvError } from "./validation.js";

describe("validateDeployEnv", () => {
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
    const result = validateDeployEnv(env);
    expect(result.GCP_PROJECT).toBe("my-project");
    expect(result.GCP_REGION).toBe("us-central1");
  });

  it("throws DeployEnvError with missing vars listed", () => {
    const env = {
      GCP_PROJECT: "my-project",
      // missing others
    };
    expect(() => validateDeployEnv(env)).toThrow(DeployEnvError);
    try {
      validateDeployEnv(env);
    } catch (e) {
      expect((e as DeployEnvError).missingVars).toContain("GCP_PROJECT_NUMBER");
      expect((e as DeployEnvError).missingVars).toContain("STATE_BUCKET");
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
    const result = validateDeployEnv(env);
    expect(result.WIF_POOL_ID).toBe("cicd-deployments");
    expect(result.WIF_PROVIDER_ID).toBe("bitbucket");
  });
});
