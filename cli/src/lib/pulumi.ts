// cli/src/lib/pulumi.ts
import { execa } from "execa";

export interface InfraOutputsParams {
  stateBucket: string;
  infraStackRef: string;
  workDir: string;
}

export interface InfraOutputs {
  registryUrl: string;
  projectId: string;
  region: string;
}

export interface DeployAppParams {
  stateBucket: string;
  stackName: string;
  workDir: string;
  config: Record<string, string>;
}

export interface DeployResult {
  url: string;
  serviceName: string;
}

export interface DestroyAppParams {
  stateBucket: string;
  stackName: string;
  workDir: string;
  projectId: string;
}

/**
 * Install npm dependencies in workDir.
 */
async function installDeps(workDir: string): Promise<void> {
  await execa("npm", ["ci", "--silent"], {
    cwd: workDir,
    stdio: "inherit",
  });
}

/**
 * Login to Pulumi with GCS backend.
 */
async function pulumiLogin(stateBucket: string, workDir: string): Promise<void> {
  await execa("pulumi", ["login", `gs://${stateBucket}`], {
    cwd: workDir,
    stdio: "inherit",
  });
}

/**
 * Get outputs from infrastructure stack.
 */
export async function getInfraOutputs(params: InfraOutputsParams): Promise<InfraOutputs> {
  const { stateBucket, infraStackRef, workDir } = params;

  await installDeps(workDir);
  await pulumiLogin(stateBucket, workDir);

  const getOutput = async (name: string): Promise<string> => {
    const result = await execa("pulumi", [
      "stack", "output", name,
      "-s", infraStackRef,
      "--show-secrets",
    ], { cwd: workDir });
    return result.stdout.trim();
  };

  const [registryUrl, projectId, region] = await Promise.all([
    getOutput("registryUrl"),
    getOutput("projectId_"),
    getOutput("region_"),
  ]);

  return { registryUrl, projectId, region };
}

/**
 * Deploy app via Pulumi.
 */
export async function deployApp(params: DeployAppParams): Promise<DeployResult> {
  const { stateBucket, stackName, workDir, config } = params;

  await installDeps(workDir);
  await pulumiLogin(stateBucket, workDir);

  // Select or create stack
  await execa("pulumi", ["stack", "select", stackName, "--create"], {
    cwd: workDir,
    stdio: "inherit",
    reject: false, // Don't throw if stack exists
  });

  // Set config values
  for (const [key, value] of Object.entries(config)) {
    await execa("pulumi", ["config", "set", key, value], {
      cwd: workDir,
      stdio: "inherit",
    });
  }

  // Run pulumi up
  await execa("pulumi", ["up", "--yes"], {
    cwd: workDir,
    stdio: "inherit",
  });

  // Get outputs
  const urlResult = await execa("pulumi", ["stack", "output", "url", "--show-secrets"], {
    cwd: workDir,
  });
  const serviceNameResult = await execa("pulumi", ["stack", "output", "serviceName_", "--show-secrets"], {
    cwd: workDir,
  });

  return {
    url: urlResult.stdout.trim(),
    serviceName: serviceNameResult.stdout.trim(),
  };
}

/**
 * Destroy app resources and remove stack.
 */
export async function destroyApp(params: DestroyAppParams): Promise<boolean> {
  const { stateBucket, stackName, workDir, projectId } = params;

  await installDeps(workDir);
  await pulumiLogin(stateBucket, workDir);

  // Try to select stack
  const selectResult = await execa("pulumi", ["stack", "select", stackName], {
    cwd: workDir,
    reject: false,
  });

  if (selectResult.exitCode !== 0) {
    console.log(`No stack found for '${stackName}', nothing to clean up`);
    return false;
  }

  // Set project config (required for destroy)
  await execa("pulumi", ["config", "set", "gcp:project", projectId], {
    cwd: workDir,
    stdio: "inherit",
  });

  // Destroy resources
  await execa("pulumi", ["destroy", "--yes"], {
    cwd: workDir,
    stdio: "inherit",
  });

  // Remove stack
  await execa("pulumi", ["stack", "rm", "--yes"], {
    cwd: workDir,
    stdio: "inherit",
  });

  return true;
}
