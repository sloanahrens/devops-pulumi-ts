// cli/src/commands/cleanup.ts
import path from "path";
import { fileURLToPath } from "url";
import type { Cloud } from "../index.js";
import {
  validateDeployEnv,
  formatMissingVarsError,
  DeployEnvError,
  type GcpDeployEnv,
  type AzureDeployEnv,
} from "../lib/validation.js";
import { normalizeBranch } from "../lib/normalize.js";
import { exchangeWifToken } from "../lib/wif/gcp.js";
import { destroyApp } from "../lib/pulumi.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface CleanupOptions {
  cloud: Cloud;
  app: string;
  branch: string;
}

async function cleanupGcp(options: CleanupOptions, env: GcpDeployEnv): Promise<void> {
  const { app, branch } = options;

  const branchTag = normalizeBranch(branch, 63);
  const stackName = `organization/app/${app}-${branchTag}`;
  console.log(`Cleaning up stack '${stackName}' for branch '${branch}'\n`);

  // Get WIF token
  console.log("Exchanging WIF token...");
  const oidcToken = env.BITBUCKET_STEP_OIDC_TOKEN || process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN!;
  const accessToken = await exchangeWifToken({
    oidcToken,
    projectNumber: env.GCP_PROJECT_NUMBER,
    poolId: env.WIF_POOL_ID,
    providerId: env.WIF_PROVIDER_ID,
    serviceAccountEmail: env.SERVICE_ACCOUNT_EMAIL,
  });
  console.log("WIF token obtained\n");

  // Set auth env vars for Pulumi provider
  process.env.CLOUDSDK_AUTH_ACCESS_TOKEN = accessToken;
  process.env.GOOGLE_OAUTH_ACCESS_TOKEN = accessToken;

  // Destroy app
  const appDir = path.resolve(__dirname, "../../../gcp/app");
  const destroyed = await destroyApp({
    stateBucket: env.STATE_BUCKET,
    stackName,
    workDir: appDir,
    projectId: env.GCP_PROJECT,
  });

  if (destroyed) {
    console.log(`\n=== Cleanup complete for branch '${branch}' ===\n`);
  } else {
    console.log(`\n=== No resources found for branch '${branch}' ===\n`);
  }
}

async function cleanupAzure(options: CleanupOptions, env: AzureDeployEnv): Promise<void> {
  const { app, branch } = options;

  const branchTag = normalizeBranch(branch, 32);
  const stackName = `organization/app/${app}-${branchTag}`;
  console.log(`Cleaning up stack '${stackName}' for branch '${branch}'\n`);

  // Azure auth is handled by azure/login action or az CLI
  console.log("Azure OIDC authentication configured by CI workflow\n");

  // Destroy app
  const appDir = path.resolve(__dirname, "../../../azure/app");
  const destroyed = await destroyApp({
    stateBucket: env.STATE_STORAGE_ACCOUNT,
    stackName,
    workDir: appDir,
    azure: true,
  });

  if (destroyed) {
    console.log(`\n=== Cleanup complete for branch '${branch}' ===\n`);
  } else {
    console.log(`\n=== No resources found for branch '${branch}' ===\n`);
  }
}

export async function cleanup(options: CleanupOptions): Promise<void> {
  const { cloud, app, branch } = options;

  console.log(`\n=== Cleaning up ${app} on ${cloud.toUpperCase()} (branch: ${branch}) ===\n`);

  // Validate environment
  console.log("Validating environment...");
  let env;
  try {
    env = validateDeployEnv(process.env, cloud);
  } catch (error) {
    if (error instanceof DeployEnvError) {
      console.error(formatMissingVarsError(error));
      process.exit(1);
    }
    throw error;
  }
  console.log("Environment validated\n");

  // Dispatch to cloud-specific implementation
  if (cloud === "gcp") {
    await cleanupGcp(options, env as GcpDeployEnv);
  } else {
    await cleanupAzure(options, env as AzureDeployEnv);
  }
}
