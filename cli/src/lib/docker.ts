// cli/src/lib/docker.ts
import { execa } from "execa";

export interface DockerLoginParams {
  registry: string;
  accessToken?: string;  // Required for GCP, optional for Azure (uses az acr login)
  azure?: boolean;
}

export interface DockerBuildParams {
  imageName: string;
  context: string;
  cacheFrom?: string;
  dockerfile?: string;
  buildArgs?: Record<string, string>;
}

/**
 * Login to Docker registry.
 * For GCP: Uses OAuth2 access token
 * For Azure: Uses `az acr login` which handles token exchange automatically
 */
export async function dockerLogin(params: DockerLoginParams): Promise<void> {
  const { registry, accessToken, azure } = params;

  if (azure) {
    // Azure: Use az acr login which uses the logged-in Azure identity
    const acrName = registry.split(".")[0]; // Extract ACR name from login server
    await execa("az", ["acr", "login", "--name", acrName], {
      stdio: "inherit",
    });
  } else {
    // GCP: Use OAuth2 access token
    if (!accessToken) {
      throw new Error("accessToken is required for GCP docker login");
    }
    await execa("docker", [
      "login",
      "-u", "oauth2accesstoken",
      "--password-stdin",
      `https://${registry}`,
    ], {
      input: accessToken,
      stdio: ["pipe", "inherit", "inherit"],
    });
  }
}

/**
 * Build Docker image with BuildKit and cache support.
 */
export async function dockerBuild(params: DockerBuildParams): Promise<void> {
  const { imageName, context, cacheFrom, dockerfile, buildArgs } = params;

  const args = [
    "build",
    "--platform", "linux/amd64",
    "--build-arg", "BUILDKIT_INLINE_CACHE=1",
  ];

  // Add custom build args
  if (buildArgs) {
    for (const [key, value] of Object.entries(buildArgs)) {
      args.push("--build-arg", `${key}=${value}`);
    }
  }

  if (cacheFrom) {
    args.push("--cache-from", cacheFrom);
  }

  if (dockerfile) {
    args.push("-f", dockerfile);
  }

  args.push("-t", imageName, context);

  await execa("docker", args, {
    stdio: "inherit",
    env: {
      ...process.env,
      DOCKER_BUILDKIT: "1",
    },
  });
}

/**
 * Push Docker image to registry.
 */
export async function dockerPush(imageName: string): Promise<void> {
  await execa("docker", ["push", imageName], {
    stdio: "inherit",
  });
}

/**
 * Pull Docker image (for caching). Returns false if image doesn't exist.
 */
export async function dockerPull(imageName: string): Promise<boolean> {
  try {
    await execa("docker", ["pull", imageName], {
      stdio: "inherit",
    });
    return true;
  } catch {
    // Image doesn't exist yet (first build)
    return false;
  }
}
