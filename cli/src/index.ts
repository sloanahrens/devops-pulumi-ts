#!/usr/bin/env node
import { Command } from "commander";
import { deploy } from "./commands/deploy.js";

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
    console.log(`Cleanup: ${options.app} (branch: ${options.branch})`);
    console.log("Not yet implemented");
  });

program.parse();
