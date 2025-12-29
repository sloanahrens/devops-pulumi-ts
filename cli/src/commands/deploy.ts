// cli/src/commands/deploy.ts
import path from "path";
import fs from "fs";
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
import { dockerLogin, dockerBuild, dockerPush, dockerPull } from "../lib/docker.js";
import { getInfraOutputs, deployApp } from "../lib/pulumi.js";
import { healthCheck } from "../lib/health.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface DeployOptions {
  cloud: Cloud;
  app: string;
  branch: string;
  context?: string;
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

async function deployGcp(options: DeployOptions, env: GcpDeployEnv): Promise<void> {
  const { app, branch, context = process.cwd() } = options;

  // Resolve resource config
  const memory = options.memory || process.env.MEMORY_LIMIT || "512Mi";
  const cpu = options.cpu || process.env.CPU_LIMIT || "1";
  const minInstances = options.minInstances ?? (process.env.MIN_INSTANCES ? parseInt(process.env.MIN_INSTANCES) : 0);
  const maxInstances = options.maxInstances ?? (process.env.MAX_INSTANCES ? parseInt(process.env.MAX_INSTANCES) : 100);
  const runtimeSa = options.runtimeSa || process.env.RUNTIME_SERVICE_ACCOUNT;
  const port = options.port ?? (process.env.CONTAINER_PORT ? parseInt(process.env.CONTAINER_PORT) : 8080);
  const allowUnauthenticated = options.private ? false : (process.env.ALLOW_UNAUTHENTICATED !== "false");
  const customDomain = options.customDomain || process.env.CUSTOM_DOMAIN;

  // Parse build args
  const buildArgs: Record<string, string> = {};
  if (options.buildArgsFromEnv) {
    for (const varName of options.buildArgsFromEnv.split(",")) {
      const trimmed = varName.trim();
      const value = process.env[trimmed];
      if (value) buildArgs[trimmed] = value;
    }
  }

  console.log(`Resources: memory=${memory}, cpu=${cpu}, minInstances=${minInstances}, maxInstances=${maxInstances}`);
  if (runtimeSa) console.log(`Runtime SA: ${runtimeSa}`);
  if (customDomain) console.log(`Custom Domain: ${customDomain}`);
  if (Object.keys(buildArgs).length > 0) console.log(`Build args: ${Object.keys(buildArgs).join(", ")}`);
  console.log();

  // Normalize branch name (GCP: 63 chars max)
  const branchTag = normalizeBranch(branch, 63);
  console.log(`Branch '${branch}' normalized to '${branchTag}'\n`);

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

  // Get infrastructure outputs
  console.log("Getting infrastructure outputs...");
  const infraDir = path.resolve(__dirname, "../../../gcp/infrastructure");
  const infraOutputs = await getInfraOutputs({
    stateBucket: env.STATE_BUCKET,
    infraStackRef: "organization/infrastructure/prod",
    workDir: infraDir,
  });
  console.log(`Registry URL: ${infraOutputs.registryUrl}\n`);

  // Docker operations
  const registry = `${env.GCP_REGION}-docker.pkg.dev`;
  console.log(`Logging into ${registry}...`);
  await dockerLogin({ registry, accessToken });
  console.log("Docker login successful\n");

  const imageName = `${infraOutputs.registryUrl}/${app}:${branchTag}`;
  console.log(`Pulling ${imageName} for cache...`);
  const pulled = await dockerPull(imageName);
  console.log(pulled ? "Existing image pulled for caching\n" : "No existing image (first build)\n");

  console.log("Building Docker image...");
  await dockerBuild({
    imageName,
    context,
    cacheFrom: pulled ? imageName : undefined,
    buildArgs: Object.keys(buildArgs).length > 0 ? buildArgs : undefined,
  });
  console.log("Build complete\n");

  console.log("Pushing Docker image...");
  await dockerPush(imageName);
  console.log("Push complete\n");

  // Deploy via Pulumi
  console.log("Deploying to Cloud Run...");
  const appDir = path.resolve(__dirname, "../../../gcp/app");

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

  if (runtimeSa) config.runtimeServiceAccountEmail = runtimeSa;
  if (customDomain) config.customDomain = customDomain;

  const result = await deployApp({
    stateBucket: env.STATE_BUCKET,
    stackName: `organization/app/${app}-${branchTag}`,
    workDir: appDir,
    config,
  });
  console.log(`Deployed to ${result.url}\n`);

  // Health check
  console.log("Running health check...");
  await healthCheck({ url: `${result.url}/health` });

  fs.writeFileSync("/tmp/service-url.txt", result.url);
  console.log("\nDeployment successful!\n");
}

async function deployAzure(options: DeployOptions, env: AzureDeployEnv): Promise<void> {
  const { app, branch, context = process.cwd() } = options;

  // Resolve resource config (Azure uses slightly different defaults)
  const memory = options.memory || process.env.MEMORY_LIMIT || "2Gi";
  const cpu = options.cpu || process.env.CPU_LIMIT || "1";
  const port = options.port ?? (process.env.CONTAINER_PORT ? parseInt(process.env.CONTAINER_PORT) : 8080);

  // Parse build args
  const buildArgs: Record<string, string> = {};
  if (options.buildArgsFromEnv) {
    for (const varName of options.buildArgsFromEnv.split(",")) {
      const trimmed = varName.trim();
      const value = process.env[trimmed];
      if (value) buildArgs[trimmed] = value;
    }
  }

  console.log(`Resources: memory=${memory}, cpu=${cpu}`);
  if (Object.keys(buildArgs).length > 0) console.log(`Build args: ${Object.keys(buildArgs).join(", ")}`);
  console.log();

  // Normalize branch name (Azure: 32 chars max for Container Apps)
  const branchTag = normalizeBranch(branch, 32);
  console.log(`Branch '${branch}' normalized to '${branchTag}'\n`);

  // Azure auth is handled by azure/login action or az CLI
  // The environment variables are set by the CI workflow
  console.log("Azure OIDC authentication configured by CI workflow\n");

  // Get infrastructure outputs
  console.log("Getting infrastructure outputs...");
  const infraDir = path.resolve(__dirname, "../../../azure/infrastructure");
  const infraOutputs = await getInfraOutputs({
    stateBucket: env.STATE_STORAGE_ACCOUNT,
    infraStackRef: "organization/infrastructure/prod",
    workDir: infraDir,
    azure: true,
  });
  console.log(`ACR Login Server: ${infraOutputs.registryUrl}\n`);

  // Docker login to ACR (uses az acr login or docker login with OIDC)
  console.log(`Logging into ${infraOutputs.registryUrl}...`);
  await dockerLogin({
    registry: infraOutputs.registryUrl,
    azure: true,
  });
  console.log("Docker login successful\n");

  const imageName = `${infraOutputs.registryUrl}/${app}:${branchTag}`;
  console.log(`Pulling ${imageName} for cache...`);
  const pulled = await dockerPull(imageName);
  console.log(pulled ? "Existing image pulled for caching\n" : "No existing image (first build)\n");

  console.log("Building Docker image...");
  await dockerBuild({
    imageName,
    context,
    cacheFrom: pulled ? imageName : undefined,
    buildArgs: Object.keys(buildArgs).length > 0 ? buildArgs : undefined,
  });
  console.log("Build complete\n");

  console.log("Pushing Docker image...");
  await dockerPush(imageName);
  console.log("Push complete\n");

  // Deploy via Pulumi
  console.log("Deploying to Container Apps...");
  const appDir = path.resolve(__dirname, "../../../azure/app");

  const config: Record<string, string> = {
    "azure-native:location": env.AZURE_LOCATION,
    appName: app,
    imageTag: branchTag,
    infraStackRef: "organization/infrastructure/prod",
    cpuLimit: cpu,
    memoryLimit: memory,
    containerPort: String(port),
  };

  const result = await deployApp({
    stateBucket: env.STATE_STORAGE_ACCOUNT,
    stackName: `organization/app/${app}-${branchTag}`,
    workDir: appDir,
    config,
    azure: true,
  });
  console.log(`Deployed to ${result.url}\n`);

  // Health check
  console.log("Running health check...");
  await healthCheck({ url: `${result.url}/health` });

  fs.writeFileSync("/tmp/service-url.txt", result.url);
  console.log("\nDeployment successful!\n");
}

export async function deploy(options: DeployOptions): Promise<void> {
  const { cloud, app, branch } = options;

  console.log(`\n=== Deploying ${app} to ${cloud.toUpperCase()} (branch: ${branch}) ===\n`);

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
    await deployGcp(options, env as GcpDeployEnv);
  } else {
    await deployAzure(options, env as AzureDeployEnv);
  }
}
