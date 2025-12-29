// cli/src/commands/deploy.ts
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { validateDeployEnv, formatMissingVarsError, DeployEnvError } from "../lib/validation.js";
import { normalizeBranch } from "../lib/normalize.js";
import { exchangeWifToken } from "../lib/wif.js";
import { dockerLogin, dockerBuild, dockerPush, dockerPull } from "../lib/docker.js";
import { getInfraOutputs, deployApp } from "../lib/pulumi.js";
import { healthCheck } from "../lib/health.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface DeployOptions {
  app: string;
  branch: string;
  context?: string;
  // Resource configuration (flags override env vars override defaults)
  memory?: string;
  cpu?: string;
  minInstances?: number;
  maxInstances?: number;
  runtimeSa?: string;
  port?: number;
  private?: boolean;
  buildArgsFromEnv?: string;
  customDomain?: string;
}

export async function deploy(options: DeployOptions): Promise<void> {
  const { app, branch, context = process.cwd() } = options;

  // Resolve resource config: flag > env var > default
  const memory = options.memory || process.env.MEMORY_LIMIT || "512Mi";
  const cpu = options.cpu || process.env.CPU_LIMIT || "1";
  const minInstances = options.minInstances ?? (process.env.MIN_INSTANCES ? parseInt(process.env.MIN_INSTANCES) : 0);
  const maxInstances = options.maxInstances ?? (process.env.MAX_INSTANCES ? parseInt(process.env.MAX_INSTANCES) : 100);
  const runtimeSa = options.runtimeSa || process.env.RUNTIME_SERVICE_ACCOUNT;
  const port = options.port ?? (process.env.CONTAINER_PORT ? parseInt(process.env.CONTAINER_PORT) : 8080);
  const allowUnauthenticated = options.private ? false : (process.env.ALLOW_UNAUTHENTICATED !== "false");
  const customDomain = options.customDomain || process.env.CUSTOM_DOMAIN;

  // Parse build args from environment variables
  const buildArgs: Record<string, string> = {};
  if (options.buildArgsFromEnv) {
    for (const varName of options.buildArgsFromEnv.split(",")) {
      const trimmed = varName.trim();
      const value = process.env[trimmed];
      if (value) {
        buildArgs[trimmed] = value;
      }
    }
  }

  console.log(`\n=== Deploying ${app} (branch: ${branch}) ===\n`);
  console.log(`Resources: memory=${memory}, cpu=${cpu}, minInstances=${minInstances}, maxInstances=${maxInstances}`);
  if (runtimeSa) {
    console.log(`Runtime SA: ${runtimeSa}`);
  }
  if (customDomain) {
    console.log(`Custom Domain: ${customDomain}`);
  }
  if (Object.keys(buildArgs).length > 0) {
    console.log(`Build args: ${Object.keys(buildArgs).join(", ")}`);
  }
  console.log();

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
  console.log(`Branch '${branch}' normalized to '${branchTag}'\n`);

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

  // Step 4: Get infrastructure outputs
  console.log("Getting infrastructure outputs...");
  const infraDir = path.resolve(__dirname, "../../../infrastructure");
  const infraOutputs = await getInfraOutputs({
    stateBucket: env.STATE_BUCKET,
    infraStackRef: "organization/infrastructure/prod",
    workDir: infraDir,
  });
  console.log(`Registry URL: ${infraOutputs.registryUrl}\n`);

  // Step 5: Docker login
  const registry = `${env.GCP_REGION}-docker.pkg.dev`;
  console.log(`Logging into ${registry}...`);
  await dockerLogin({ registry, accessToken });
  console.log("Docker login successful\n");

  // Step 6: Pull existing image for cache
  const imageName = `${infraOutputs.registryUrl}/${app}:${branchTag}`;
  console.log(`Pulling ${imageName} for cache...`);
  const pulled = await dockerPull(imageName);
  if (pulled) {
    console.log("Existing image pulled for caching\n");
  } else {
    console.log("No existing image (first build)\n");
  }

  // Step 7: Build image
  console.log("Building Docker image...");
  await dockerBuild({
    imageName,
    context,
    cacheFrom: pulled ? imageName : undefined,
    buildArgs: Object.keys(buildArgs).length > 0 ? buildArgs : undefined,
  });
  console.log("Build complete\n");

  // Step 8: Push image
  console.log("Pushing Docker image...");
  await dockerPush(imageName);
  console.log("Push complete\n");

  // Step 9: Deploy via Pulumi
  console.log("Deploying to Cloud Run...");
  const appDir = path.resolve(__dirname, "../../../app");

  // Build config with resource settings
  const config: Record<string, string> = {
    "gcp:project": env.GCP_PROJECT,
    appName: app,
    imageTag: branchTag,
    infraStackRef: "organization/infrastructure/prod",
    region: env.GCP_REGION,
    memoryLimit: memory,
    cpuLimit: cpu,
    minInstances: String(minInstances),
    maxInstances: String(maxInstances),
    containerPort: String(port),
    allowUnauthenticated: String(allowUnauthenticated),
  };

  if (runtimeSa) {
    config.runtimeServiceAccountEmail = runtimeSa;
  }
  if (customDomain) {
    config.customDomain = customDomain;
  }

  const result = await deployApp({
    stateBucket: env.STATE_BUCKET,
    stackName: `organization/app/${app}-${branchTag}`,
    workDir: appDir,
    config,
  });
  console.log(`Deployed to ${result.url}\n`);

  // Step 10: Health check
  console.log("Running health check...");
  await healthCheck({ url: `${result.url}/health` });

  // Write URL to file for pipeline to echo as separate step
  fs.writeFileSync("/tmp/service-url.txt", result.url);

  console.log("\nDeployment successful!\n");
}
