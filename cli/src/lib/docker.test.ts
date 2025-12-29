// cli/src/lib/docker.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { dockerLogin, dockerBuild, dockerPush, dockerPull } from "./docker.js";

// Mock execa
vi.mock("execa", () => ({
  execa: vi.fn(),
}));

import { execa } from "execa";
const mockExeca = vi.mocked(execa);

describe("docker functions", () => {
  beforeEach(() => {
    mockExeca.mockReset();
  });

  describe("dockerLogin", () => {
    it("logs into registry with access token", async () => {
      mockExeca.mockResolvedValueOnce({ stdout: "Login Succeeded", stderr: "", exitCode: 0 } as any);

      await dockerLogin({
        registry: "us-central1-docker.pkg.dev",
        accessToken: "token123",
      });

      expect(mockExeca).toHaveBeenCalledWith(
        "docker",
        ["login", "-u", "oauth2accesstoken", "--password-stdin", "https://us-central1-docker.pkg.dev"],
        expect.objectContaining({ input: "token123" })
      );
    });
  });

  describe("dockerBuild", () => {
    it("builds with cache-from and BuildKit", async () => {
      mockExeca.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 } as any);

      await dockerBuild({
        imageName: "us-central1-docker.pkg.dev/proj/repo/app:main",
        context: "/app",
        cacheFrom: "us-central1-docker.pkg.dev/proj/repo/app:main",
      });

      expect(mockExeca).toHaveBeenCalledWith(
        "docker",
        expect.arrayContaining([
          "build",
          "--platform", "linux/amd64",
          "--build-arg", "BUILDKIT_INLINE_CACHE=1",
          "--cache-from", "us-central1-docker.pkg.dev/proj/repo/app:main",
          "-t", "us-central1-docker.pkg.dev/proj/repo/app:main",
          "/app",
        ]),
        expect.objectContaining({ env: expect.objectContaining({ DOCKER_BUILDKIT: "1" }) })
      );
    });
  });

  describe("dockerPull", () => {
    it("returns true on success", async () => {
      mockExeca.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 } as any);
      const result = await dockerPull("image:tag");
      expect(result).toBe(true);
    });

    it("returns false on failure (no throw)", async () => {
      mockExeca.mockRejectedValueOnce(new Error("not found"));
      const result = await dockerPull("image:tag");
      expect(result).toBe(false);
    });
  });
});
