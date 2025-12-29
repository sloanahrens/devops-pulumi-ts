// cli/src/commands/cleanup.ts
import path from "path";
import { fileURLToPath } from "url";
import { validateDeployEnv, formatMissingVarsError, DeployEnvError } from "../lib/validation.js";
import { normalizeBranch } from "../lib/normalize.js";
import { exchangeWifToken } from "../lib/wif/gcp.js";
import { destroyApp } from "../lib/pulumi.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface CleanupOptions {
  app: string;
  branch: string;
}

export async function cleanup(options: CleanupOptions): Promise<void> {
  const { app, branch } = options;

  console.log(`\n=== Cleaning up ${app} (branch: ${branch}) ===\n`);

  // Step 1: Validate environment
  console.log("Validating environment...");
  let env;
  try {
    env = validateDeployEnv(process.env);
  } catch (error) {
    if (error instanceof DeployEnvError) {
      console.error(formatMissingVarsError(error));
      process.exit(1);
    }
    throw error;
  }
  console.log("Environment validated\n");

  // Step 2: Normalize branch name
  const branchTag = normalizeBranch(branch);
  const stackName = `organization/app/${app}-${branchTag}`;
  console.log(`Cleaning up stack '${stackName}' for branch '${branch}'\n`);

  // Step 3: Get WIF token
  console.log("Exchanging WIF token...");
  const accessToken = await exchangeWifToken({
    oidcToken: env.BITBUCKET_STEP_OIDC_TOKEN,
    projectNumber: env.GCP_PROJECT_NUMBER,
    poolId: env.WIF_POOL_ID,
    providerId: env.WIF_PROVIDER_ID,
    serviceAccountEmail: env.SERVICE_ACCOUNT_EMAIL,
  });
  console.log("WIF token obtained\n");

  // Set auth env vars for Pulumi provider
  process.env.CLOUDSDK_AUTH_ACCESS_TOKEN = accessToken;
  process.env.GOOGLE_OAUTH_ACCESS_TOKEN = accessToken;

  // Step 4: Destroy app
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
