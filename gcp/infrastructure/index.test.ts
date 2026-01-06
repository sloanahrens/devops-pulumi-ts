import { describe, it, expect, beforeAll } from "vitest";
import * as pulumi from "@pulumi/pulumi";

// Store created resources for assertions
const resources: Array<{ type: string; name: string; inputs: Record<string, unknown> }> = [];

// Set required config values BEFORE setting mocks
pulumi.runtime.setAllConfig({
    "gcp:project": "test-project-123",
    "project:region": "us-central1",
    "project:deployServiceAccountEmail": "pulumi-deploy@test-project-123.iam.gserviceaccount.com",
    "project:bitbucketWorkspaceUuid": "{test-uuid-12345}",
    "project:bitbucketWorkspaceSlug": "test-workspace",
    "project:githubOwner": "test-org",
});

// Mock Pulumi runtime
pulumi.runtime.setMocks(
    {
        newResource: (args: pulumi.runtime.MockResourceArgs) => {
            resources.push({
                type: args.type,
                name: args.name,
                inputs: args.inputs,
            });

            const defaults: Record<string, unknown> = {};

            if (args.type === "gcp:artifactregistry/repository:Repository") {
                defaults.name = args.inputs.repositoryId || args.name;
            }
            if (args.type === "gcp:iam/workloadIdentityPool:WorkloadIdentityPool") {
                defaults.name = `projects/test-project-123/locations/global/workloadIdentityPools/${args.inputs.workloadIdentityPoolId}`;
                defaults.workloadIdentityPoolId = args.inputs.workloadIdentityPoolId;
            }
            if (args.type === "gcp:iam/workloadIdentityPoolProvider:WorkloadIdentityPoolProvider") {
                defaults.name = `projects/test-project-123/locations/global/workloadIdentityPools/cicd-deployments/providers/${args.inputs.workloadIdentityPoolProviderId}`;
            }
            if (args.type === "gcp:projects/iAMCustomRole:IAMCustomRole") {
                defaults.name = `projects/test-project-123/roles/${args.inputs.roleId}`;
            }

            return {
                id: `${args.name}-id`,
                state: { ...args.inputs, ...defaults },
            };
        },
        call: (args: pulumi.runtime.MockCallArgs) => {
            if (args.token === "gcp:organizations/getProject:getProject") {
                return {
                    projectId: "test-project-123",
                    number: "123456789",
                };
            }
            return {};
        },
    },
    "project",
    "stack",
    false
);

// Helper function to convert pulumi.Output to a promise
function promiseOf<T>(output: pulumi.Output<T>): Promise<T> {
    return new Promise(resolve => output.apply(resolve));
}

describe("Infrastructure Stack", () => {
    let outputs: typeof import("./index");

    beforeAll(async () => {
        outputs = await import("./index");
        // Wait for all resources to be created
        await Promise.all([
            promiseOf(outputs.registryUrl),
            promiseOf(outputs.wifPoolId),
            promiseOf(outputs.projectNumber),
            promiseOf(outputs.customRoleCloudRun),
            promiseOf(outputs.customRoleArtifactRegistry),
        ]);
    });

    describe("API Services", () => {
        it("should enable Artifact Registry API", () => {
            const api = resources.find(
                r => r.type === "gcp:projects/service:Service" &&
                     r.inputs.service === "artifactregistry.googleapis.com"
            );
            expect(api).toBeDefined();
            expect(api?.inputs.disableOnDestroy).toBe(false);
        });

        it("should enable Cloud Run API", () => {
            const api = resources.find(
                r => r.type === "gcp:projects/service:Service" &&
                     r.inputs.service === "run.googleapis.com"
            );
            expect(api).toBeDefined();
            expect(api?.inputs.disableOnDestroy).toBe(false);
        });

        it("should enable IAM Credentials API", () => {
            const api = resources.find(
                r => r.type === "gcp:projects/service:Service" &&
                     r.inputs.service === "iamcredentials.googleapis.com"
            );
            expect(api).toBeDefined();
        });

        it("should enable STS API", () => {
            const api = resources.find(
                r => r.type === "gcp:projects/service:Service" &&
                     r.inputs.service === "sts.googleapis.com"
            );
            expect(api).toBeDefined();
        });
    });

    describe("Artifact Registry", () => {
        it("should create Docker repository", () => {
            const repo = resources.find(r => r.type === "gcp:artifactregistry/repository:Repository");
            expect(repo).toBeDefined();
            expect(repo?.inputs.repositoryId).toBe("apps-docker");
            expect(repo?.inputs.format).toBe("DOCKER");
        });

        it("should set repository in correct region", () => {
            const repo = resources.find(r => r.type === "gcp:artifactregistry/repository:Repository");
            expect(repo?.inputs.location).toBe("us-central1");
        });

        it("should apply correct labels", () => {
            const repo = resources.find(r => r.type === "gcp:artifactregistry/repository:Repository");
            expect(repo?.inputs.labels).toMatchObject({
                "managed-by": "pulumi",
                "purpose": "shared-infrastructure",
            });
        });
    });

    describe("Workload Identity Pool", () => {
        it("should create WIF pool for CI/CD", () => {
            const pool = resources.find(r => r.type === "gcp:iam/workloadIdentityPool:WorkloadIdentityPool");
            expect(pool).toBeDefined();
            expect(pool?.inputs.workloadIdentityPoolId).toBe("cicd-deployments");
            expect(pool?.inputs.displayName).toBe("CI/CD Deployments");
        });
    });

    describe("Bitbucket WIF Provider", () => {
        it("should create Bitbucket OIDC provider", () => {
            const provider = resources.find(
                r => r.type === "gcp:iam/workloadIdentityPoolProvider:WorkloadIdentityPoolProvider" &&
                     r.inputs.workloadIdentityPoolProviderId === "bitbucket"
            );
            expect(provider).toBeDefined();
            expect(provider?.inputs.displayName).toBe("Bitbucket OIDC Provider");
        });

        it("should use correct Bitbucket issuer URI", () => {
            const provider = resources.find(
                r => r.type === "gcp:iam/workloadIdentityPoolProvider:WorkloadIdentityPoolProvider" &&
                     r.inputs.workloadIdentityPoolProviderId === "bitbucket"
            );
            const oidc = provider?.inputs.oidc as Record<string, unknown>;
            expect(oidc?.issuerUri).toContain("api.bitbucket.org");
            expect(oidc?.issuerUri).toContain("test-workspace");
        });

        it("should set attribute condition for workspace UUID", () => {
            const provider = resources.find(
                r => r.type === "gcp:iam/workloadIdentityPoolProvider:WorkloadIdentityPoolProvider" &&
                     r.inputs.workloadIdentityPoolProviderId === "bitbucket"
            );
            expect(provider?.inputs.attributeCondition).toContain("{test-uuid-12345}");
        });

        it("should configure Bitbucket attribute mappings", () => {
            const provider = resources.find(
                r => r.type === "gcp:iam/workloadIdentityPoolProvider:WorkloadIdentityPoolProvider" &&
                     r.inputs.workloadIdentityPoolProviderId === "bitbucket"
            );
            const mapping = provider?.inputs.attributeMapping as Record<string, unknown>;
            expect(mapping?.["google.subject"]).toBe("assertion.sub");
            expect(mapping?.["attribute.repository_uuid"]).toBe("assertion.repositoryUuid");
            expect(mapping?.["attribute.workspace_uuid"]).toBe("assertion.workspaceUuid");
        });
    });

    describe("GitHub WIF Provider", () => {
        it("should create GitHub OIDC provider", () => {
            const provider = resources.find(
                r => r.type === "gcp:iam/workloadIdentityPoolProvider:WorkloadIdentityPoolProvider" &&
                     r.inputs.workloadIdentityPoolProviderId === "github"
            );
            expect(provider).toBeDefined();
            expect(provider?.inputs.displayName).toBe("GitHub OIDC Provider");
        });

        it("should use correct GitHub issuer URI", () => {
            const provider = resources.find(
                r => r.type === "gcp:iam/workloadIdentityPoolProvider:WorkloadIdentityPoolProvider" &&
                     r.inputs.workloadIdentityPoolProviderId === "github"
            );
            const oidc = provider?.inputs.oidc as Record<string, unknown>;
            expect(oidc?.issuerUri).toBe("https://token.actions.githubusercontent.com");
        });

        it("should set attribute condition for owner", () => {
            const provider = resources.find(
                r => r.type === "gcp:iam/workloadIdentityPoolProvider:WorkloadIdentityPoolProvider" &&
                     r.inputs.workloadIdentityPoolProviderId === "github"
            );
            expect(provider?.inputs.attributeCondition).toContain("test-org");
        });

        it("should configure GitHub attribute mappings", () => {
            const provider = resources.find(
                r => r.type === "gcp:iam/workloadIdentityPoolProvider:WorkloadIdentityPoolProvider" &&
                     r.inputs.workloadIdentityPoolProviderId === "github"
            );
            const mapping = provider?.inputs.attributeMapping as Record<string, unknown>;
            expect(mapping?.["google.subject"]).toBe("assertion.sub");
            expect(mapping?.["attribute.actor"]).toBe("assertion.actor");
            expect(mapping?.["attribute.repository"]).toBe("assertion.repository");
            expect(mapping?.["attribute.repository_owner"]).toBe("assertion.repository_owner");
        });
    });

    describe("WIF Service Account Binding", () => {
        it("should bind WIF pool to deploy service account", () => {
            const binding = resources.find(
                r => r.type === "gcp:serviceaccount/iAMBinding:IAMBinding" &&
                     r.name === "wif-sa-binding"
            );
            expect(binding).toBeDefined();
            expect(binding?.inputs.role).toBe("roles/iam.workloadIdentityUser");
        });
    });

    describe("Custom IAM Roles", () => {
        it("should create Cloud Run deploy custom role", () => {
            const role = resources.find(
                r => r.type === "gcp:projects/iAMCustomRole:IAMCustomRole" &&
                     r.inputs.roleId === "pulumiCloudRunDeploy"
            );
            expect(role).toBeDefined();
            expect(role?.inputs.title).toBe("Pulumi Cloud Run Deploy");
        });

        it("should include Cloud Run service permissions", () => {
            const role = resources.find(
                r => r.type === "gcp:projects/iAMCustomRole:IAMCustomRole" &&
                     r.inputs.roleId === "pulumiCloudRunDeploy"
            );
            const permissions = role?.inputs.permissions as string[];
            expect(permissions).toContain("run.services.create");
            expect(permissions).toContain("run.services.update");
            expect(permissions).toContain("run.services.delete");
            expect(permissions).toContain("run.services.setIamPolicy");
        });

        it("should create Artifact Registry custom role", () => {
            const role = resources.find(
                r => r.type === "gcp:projects/iAMCustomRole:IAMCustomRole" &&
                     r.inputs.roleId === "pulumiArtifactRegistry"
            );
            expect(role).toBeDefined();
            expect(role?.inputs.title).toBe("Pulumi Artifact Registry");
        });

        it("should include Artifact Registry permissions", () => {
            const role = resources.find(
                r => r.type === "gcp:projects/iAMCustomRole:IAMCustomRole" &&
                     r.inputs.roleId === "pulumiArtifactRegistry"
            );
            const permissions = role?.inputs.permissions as string[];
            expect(permissions).toContain("artifactregistry.repositories.uploadArtifacts");
            expect(permissions).toContain("artifactregistry.repositories.downloadArtifacts");
            expect(permissions).toContain("artifactregistry.tags.create");
        });
    });

    describe("IAM Bindings", () => {
        it("should grant custom Cloud Run role to deploy SA", () => {
            const binding = resources.find(
                r => r.type === "gcp:projects/iAMMember:IAMMember" &&
                     r.name === "deploy-run-custom"
            );
            expect(binding).toBeDefined();
            expect(binding?.inputs.member).toContain("pulumi-deploy@test-project-123.iam.gserviceaccount.com");
        });

        it("should grant custom Artifact Registry role to deploy SA", () => {
            const binding = resources.find(
                r => r.type === "gcp:projects/iAMMember:IAMMember" &&
                     r.name === "deploy-artifact-custom"
            );
            expect(binding).toBeDefined();
            expect(binding?.inputs.member).toContain("pulumi-deploy@test-project-123.iam.gserviceaccount.com");
        });

        it("should grant service account user role to deploy SA", () => {
            const binding = resources.find(
                r => r.type === "gcp:projects/iAMMember:IAMMember" &&
                     r.name === "deploy-sa-user"
            );
            expect(binding).toBeDefined();
            expect(binding?.inputs.role).toBe("roles/iam.serviceAccountUser");
        });

        it("should grant Cloud Run service agent access to Artifact Registry", () => {
            const binding = resources.find(
                r => r.type === "gcp:projects/iAMMember:IAMMember" &&
                     r.name === "cloudrun-registry-reader"
            );
            expect(binding).toBeDefined();
            expect(binding?.inputs.role).toBe("roles/artifactregistry.reader");
        });
    });

    describe("Exports", () => {
        it("should export registryUrl in correct format", async () => {
            const value = await promiseOf(outputs.registryUrl);
            expect(value).toMatch(/us-central1-docker\.pkg\.dev\/test-project-123\/apps-docker/);
        });

        it("should export wifPoolId", async () => {
            const value = await promiseOf(outputs.wifPoolId);
            expect(value).toBeDefined();
        });

        it("should export wifPoolName", async () => {
            const value = await promiseOf(outputs.wifPoolName);
            expect(value).toContain("cicd-deployments");
        });

        it("should export projectNumber", async () => {
            const value = await promiseOf(outputs.projectNumber);
            expect(value).toBe("123456789");
        });

        it("should export custom role names", async () => {
            const cloudRunRole = await promiseOf(outputs.customRoleCloudRun);
            const artifactRole = await promiseOf(outputs.customRoleArtifactRegistry);
            expect(cloudRunRole).toContain("pulumiCloudRunDeploy");
            expect(artifactRole).toContain("pulumiArtifactRegistry");
        });

        it("should export deployServiceAccountEmail", () => {
            expect(outputs.deployServiceAccountEmail_).toBe("pulumi-deploy@test-project-123.iam.gserviceaccount.com");
        });

        it("should export projectId", () => {
            expect(outputs.projectId_).toBe("test-project-123");
        });

        it("should export region", () => {
            expect(outputs.region_).toBe("us-central1");
        });

        it("should export Bitbucket provider outputs", async () => {
            const providerId = await promiseOf(outputs.bitbucketProviderId!);
            expect(providerId).toBeDefined();
        });

        it("should export GitHub provider outputs", async () => {
            const providerId = await promiseOf(outputs.githubProviderId!);
            expect(providerId).toBeDefined();
        });
    });
});
