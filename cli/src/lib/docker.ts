// cli/src/lib/docker.ts
import { execa } from "execa";

export interface DockerLoginParams {
  registry: string;
  accessToken: string;
}

export interface DockerBuildParams {
  imageName: string;
  context: string;
  cacheFrom?: string;
  dockerfile?: string;
}

/**
 * Login to Docker registry using access token.
 */
export async function dockerLogin(params: DockerLoginParams): Promise<void> {
  const { registry, accessToken } = params;

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

/**
 * Build Docker image with BuildKit and cache support.
 */
export async function dockerBuild(params: DockerBuildParams): Promise<void> {
  const { imageName, context, cacheFrom, dockerfile } = params;

  const args = [
    "build",
    "--platform", "linux/amd64",
    "--build-arg", "BUILDKIT_INLINE_CACHE=1",
  ];

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
