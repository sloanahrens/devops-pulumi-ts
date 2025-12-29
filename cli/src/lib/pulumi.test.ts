// cli/src/lib/pulumi.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { getInfraOutputs, deployApp, destroyApp } from "./pulumi.js";

// Mock execa for pulumi CLI calls
vi.mock("execa", () => ({
  execa: vi.fn(),
}));

import { execa } from "execa";
const mockExeca = vi.mocked(execa);

describe("pulumi functions", () => {
  beforeEach(() => {
    mockExeca.mockReset();
  });

  describe("getInfraOutputs", () => {
    it("gets registry URL from infrastructure stack", async () => {
      // Mock npm ci
      mockExeca.mockResolvedValueOnce({ exitCode: 0 } as any);
      // Mock login
      mockExeca.mockResolvedValueOnce({ exitCode: 0 } as any);
      // Mock outputs
      mockExeca.mockResolvedValueOnce({ stdout: "us-central1-docker.pkg.dev/project/apps-docker", exitCode: 0 } as any);
      mockExeca.mockResolvedValueOnce({ stdout: "my-project", exitCode: 0 } as any);
      mockExeca.mockResolvedValueOnce({ stdout: "us-central1", exitCode: 0 } as any);

      const result = await getInfraOutputs({
        stateBucket: "my-bucket",
        infraStackRef: "organization/infrastructure/prod",
        workDir: "/path/to/infrastructure",
      });

      expect(result.registryUrl).toBe("us-central1-docker.pkg.dev/project/apps-docker");
      expect(result.projectId).toBe("my-project");
      expect(result.region).toBe("us-central1");
    });
  });

  describe("deployApp", () => {
    it("runs pulumi up with correct config", async () => {
      // Mock all calls to succeed
      mockExeca.mockResolvedValue({ exitCode: 0, stdout: "" } as any);

      await deployApp({
        stateBucket: "my-bucket",
        stackName: "organization/app/myapp-main",
        workDir: "/path/to/app",
        config: {
          "gcp:project": "my-project",
          appName: "myapp",
          imageTag: "main",
          infraStackRef: "organization/infrastructure/prod",
          region: "us-central1",
        },
      });

      // Verify pulumi up was called
      expect(mockExeca).toHaveBeenCalledWith(
        "pulumi",
        expect.arrayContaining(["up", "--yes"]),
        expect.any(Object)
      );
    });
  });

  describe("destroyApp", () => {
    it("destroys and removes stack", async () => {
      mockExeca.mockResolvedValue({ exitCode: 0, stdout: "" } as any);

      const result = await destroyApp({
        stateBucket: "my-bucket",
        stackName: "organization/app/myapp-main",
        workDir: "/path/to/app",
        projectId: "my-project",
      });

      expect(result).toBe(true);
      expect(mockExeca).toHaveBeenCalledWith(
        "pulumi",
        expect.arrayContaining(["destroy", "--yes"]),
        expect.any(Object)
      );
    });
  });
});
