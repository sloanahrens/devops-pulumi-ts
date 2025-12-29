#!/usr/bin/env node
import { Command } from "commander";
import { deploy } from "./commands/deploy.js";
import { cleanup } from "./commands/cleanup.js";

const program = new Command();

program
  .name("devops-gcp")
  .description("CLI for deploying apps to GCP Cloud Run via Pulumi")
  .version("1.0.0");

program
  .command("deploy")
  .description("Build, push, and deploy an app to Cloud Run")
  .requiredOption("--app <name>", "Application name")
  .requiredOption("--branch <name>", "Git branch name")
  .option("--context <path>", "Docker build context", process.cwd())
  .option("--memory <size>", "Memory limit (e.g., 512Mi, 1Gi)")
  .option("--cpu <limit>", "CPU limit (e.g., 1, 2)")
  .option("--min-instances <count>", "Minimum instances", parseInt)
  .option("--max-instances <count>", "Maximum instances", parseInt)
  .option("--runtime-sa <email>", "Runtime service account email")
  .option("--port <number>", "Container port", parseInt)
  .option("--private", "Require authentication (disable public access)")
  .option("--build-args-from-env <vars>", "Comma-separated env var names to pass as Docker build args")
  .action(async (options) => {
    try {
      await deploy(options);
    } catch (error) {
      console.error("Deploy failed:", error);
      process.exit(1);
    }
  });

program
  .command("cleanup")
  .description("Destroy resources for a deleted branch")
  .requiredOption("--app <name>", "Application name")
  .requiredOption("--branch <name>", "Deleted branch name")
  .action(async (options) => {
    try {
      await cleanup(options);
    } catch (error) {
      console.error("Cleanup failed:", error);
      process.exit(1);
    }
  });

program.parse();
