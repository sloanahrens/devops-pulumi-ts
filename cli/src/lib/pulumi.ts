// cli/src/lib/pulumi.ts
import { execa } from "execa";

export interface InfraOutputsParams {
  stateBucket: string;
  infraStackRef: string;
  workDir: string;
  azure?: boolean;
}

export interface InfraOutputs {
  registryUrl: string;
  projectId?: string;  // GCP only
  region?: string;     // GCP only
  resourceGroupName?: string;  // Azure only
  environmentId?: string;      // Azure only
}

export interface DeployAppParams {
  stateBucket: string;
  stackName: string;
  workDir: string;
  config: Record<string, string>;
  azure?: boolean;
}

export interface DeployResult {
  url: string;
  serviceName: string;
}

export interface DestroyAppParams {
  stateBucket: string;
  stackName: string;
  workDir: string;
  projectId?: string;  // GCP
  resourceGroupName?: string;  // Azure
  azure?: boolean;
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
 * Login to Pulumi backend.
 * GCP: gs://bucket
 * Azure: azblob://container?storage_account=name
 */
async function pulumiLogin(stateBucket: string, workDir: string, azure?: boolean): Promise<void> {
  const backendUrl = azure
    ? `azblob://state?storage_account=${stateBucket}`
    : `gs://${stateBucket}`;

  await execa("pulumi", ["login", backendUrl], {
    cwd: workDir,
    stdio: "inherit",
  });
}

/**
 * Get outputs from infrastructure stack.
 */
export async function getInfraOutputs(params: InfraOutputsParams): Promise<InfraOutputs> {
  const { stateBucket, infraStackRef, workDir, azure } = params;

  await installDeps(workDir);
  await pulumiLogin(stateBucket, workDir, azure);

  const getOutput = async (name: string): Promise<string> => {
    const result = await execa("pulumi", [
      "stack", "output", name,
      "-s", infraStackRef,
      "--show-secrets",
    ], { cwd: workDir });
    return result.stdout.trim();
  };

  if (azure) {
    const [registryUrl, resourceGroupName, environmentId] = await Promise.all([
      getOutput("acrLoginServer"),
      getOutput("resourceGroupName"),
      getOutput("environmentId"),
    ]);
    return { registryUrl, resourceGroupName, environmentId };
  } else {
    const [registryUrl, projectId, region] = await Promise.all([
      getOutput("registryUrl"),
      getOutput("projectId_"),
      getOutput("region_"),
    ]);
    return { registryUrl, projectId, region };
  }
}

/**
 * Deploy app via Pulumi.
 */
export async function deployApp(params: DeployAppParams): Promise<DeployResult> {
  const { stateBucket, stackName, workDir, config, azure } = params;

  await installDeps(workDir);
  await pulumiLogin(stateBucket, workDir, azure);

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
  const { stateBucket, stackName, workDir, projectId, azure } = params;

  await installDeps(workDir);
  await pulumiLogin(stateBucket, workDir, azure);

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
  if (azure) {
    // Azure doesn't need project config for destroy
  } else if (projectId) {
    await execa("pulumi", ["config", "set", "gcp:project", projectId], {
      cwd: workDir,
      stdio: "inherit",
    });
  }

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
