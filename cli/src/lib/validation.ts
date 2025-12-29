import { z } from "zod";
import type { Cloud } from "../index.js";

// GCP-specific environment schema
const gcpEnvSchema = z.object({
  // Required
  GCP_PROJECT: z.string().min(1),
  GCP_PROJECT_NUMBER: z.string().min(1),
  GCP_REGION: z.string().min(1),
  STATE_BUCKET: z.string().min(1),
  SERVICE_ACCOUNT_EMAIL: z.string().email(),
  PULUMI_CONFIG_PASSPHRASE: z.string().min(1),
  // OIDC token (one of GitHub or Bitbucket required)
  BITBUCKET_STEP_OIDC_TOKEN: z.string().optional(),
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: z.string().optional(),
  // Optional with defaults
  WIF_POOL_ID: z.string().default("cicd-deployments"),
  WIF_PROVIDER_ID: z.string().default("bitbucket"),
});

// Azure-specific environment schema
const azureEnvSchema = z.object({
  // Required
  AZURE_CLIENT_ID: z.string().min(1),
  AZURE_TENANT_ID: z.string().min(1),
  AZURE_SUBSCRIPTION_ID: z.string().min(1),
  AZURE_RESOURCE_GROUP: z.string().min(1),
  STATE_STORAGE_ACCOUNT: z.string().min(1),
  PULUMI_CONFIG_PASSPHRASE: z.string().min(1),
  // OIDC token (one of GitHub or Bitbucket required)
  BITBUCKET_STEP_OIDC_TOKEN: z.string().optional(),
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: z.string().optional(),
  // Optional
  AZURE_LOCATION: z.string().default("eastus"),
});

export type GcpDeployEnv = z.infer<typeof gcpEnvSchema>;
export type AzureDeployEnv = z.infer<typeof azureEnvSchema>;
export type DeployEnv = GcpDeployEnv | AzureDeployEnv;

export class DeployEnvError extends Error {
  constructor(public missingVars: string[], public cloud: Cloud) {
    super(`Missing required environment variables: ${missingVars.join(", ")}`);
    this.name = "DeployEnvError";
  }
}

function validateOidcToken(env: Record<string, string | undefined>): void {
  const hasBitbucket = !!env.BITBUCKET_STEP_OIDC_TOKEN;
  const hasGitHub = !!env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;

  if (!hasBitbucket && !hasGitHub) {
    throw new DeployEnvError(
      ["BITBUCKET_STEP_OIDC_TOKEN or ACTIONS_ID_TOKEN_REQUEST_TOKEN"],
      "gcp" // Will be overwritten by caller
    );
  }
}

export function validateGcpEnv(env: Record<string, string | undefined>): GcpDeployEnv {
  const result = gcpEnvSchema.safeParse(env);

  if (!result.success) {
    const missingVars = result.error.issues
      .filter(issue => issue.code === "invalid_type" && issue.received === "undefined")
      .map(issue => issue.path[0] as string);

    if (missingVars.length > 0) {
      throw new DeployEnvError(missingVars, "gcp");
    }

    throw new Error(`Environment validation failed: ${result.error.message}`);
  }

  validateOidcToken(env);
  return result.data;
}

export function validateAzureEnv(env: Record<string, string | undefined>): AzureDeployEnv {
  const result = azureEnvSchema.safeParse(env);

  if (!result.success) {
    const missingVars = result.error.issues
      .filter(issue => issue.code === "invalid_type" && issue.received === "undefined")
      .map(issue => issue.path[0] as string);

    if (missingVars.length > 0) {
      throw new DeployEnvError(missingVars, "azure");
    }

    throw new Error(`Environment validation failed: ${result.error.message}`);
  }

  validateOidcToken(env);
  return result.data;
}

export function validateDeployEnv(env: Record<string, string | undefined>, cloud: Cloud): DeployEnv {
  return cloud === "gcp" ? validateGcpEnv(env) : validateAzureEnv(env);
}

export function formatMissingVarsError(error: DeployEnvError): string {
  const ciHint = error.cloud === "gcp"
    ? "Set these in: Repository Settings > Pipelines > Repository variables"
    : "Set these in: Repository Settings > Secrets and variables > Actions";

  const lines = [
    "==============================================",
    `ERROR: Missing required ${error.cloud.toUpperCase()} environment variables:`,
    "==============================================",
    ...error.missingVars.map(v => `  - ${v}`),
    "",
    ciHint,
  ];
  return lines.join("\n");
}
