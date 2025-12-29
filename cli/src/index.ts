#!/usr/bin/env node
import { Command } from "commander";
import { deploy } from "./commands/deploy.js";
import { cleanup } from "./commands/cleanup.js";

export type Cloud = "gcp" | "azure";

function detectCloud(): Cloud | undefined {
  // Check environment variable first
  const envCloud = process.env.DEPLOY_CLOUD?.toLowerCase();
  if (envCloud === "gcp" || envCloud === "azure") {
    return envCloud;
  }
  // Auto-detect from environment
  if (process.env.GCP_PROJECT) return "gcp";
  if (process.env.AZURE_SUBSCRIPTION_ID) return "azure";
  return undefined;
}

function resolveCloud(explicit?: string): Cloud {
  if (explicit) {
    const cloud = explicit.toLowerCase();
    if (cloud !== "gcp" && cloud !== "azure") {
      console.error(`Invalid cloud: ${explicit}. Must be 'gcp' or 'azure'.`);
      process.exit(1);
    }
    return cloud as Cloud;
  }
  const detected = detectCloud();
  if (!detected) {
    console.error("Could not detect cloud. Use --cloud gcp|azure or set DEPLOY_CLOUD env var.");
    process.exit(1);
  }
  return detected;
}

const program = new Command();

program
  .name("devops-deploy")
  .description("CLI for deploying containerized apps to GCP Cloud Run or Azure Container Apps")
  .version("1.0.0");

program
  .command("deploy")
  .description("Build, push, and deploy an app")
  .option("--cloud <provider>", "Cloud provider (gcp or azure)")
  .requiredOption("--app <name>", "Application name")
  .requiredOption("--branch <name>", "Git branch name")
  .option("--context <path>", "Docker build context", process.cwd())
  .option("--memory <size>", "Memory limit (e.g., 512Mi, 1Gi)")
  .option("--cpu <limit>", "CPU limit (e.g., 1, 2)")
  .option("--min-instances <count>", "Minimum instances", parseInt)
  .option("--max-instances <count>", "Maximum instances", parseInt)
  .option("--runtime-sa <email>", "Runtime service account email (GCP only)")
  .option("--port <number>", "Container port", parseInt)
  .option("--private", "Require authentication (disable public access)")
  .option("--build-args-from-env <vars>", "Comma-separated env var names to pass as Docker build args")
  .option("--custom-domain <domain>", "Custom domain to map")
  .action(async (options) => {
    try {
      const cloud = resolveCloud(options.cloud);
      await deploy({ ...options, cloud });
    } catch (error) {
      console.error("Deploy failed:", error);
      process.exit(1);
    }
  });

program
  .command("cleanup")
  .description("Destroy resources for a deleted branch")
  .option("--cloud <provider>", "Cloud provider (gcp or azure)")
  .requiredOption("--app <name>", "Application name")
  .requiredOption("--branch <name>", "Deleted branch name")
  .action(async (options) => {
    try {
      const cloud = resolveCloud(options.cloud);
      await cleanup({ ...options, cloud });
    } catch (error) {
      console.error("Cleanup failed:", error);
      process.exit(1);
    }
  });

program.parse();
