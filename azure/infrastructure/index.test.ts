import { describe, it, expect, beforeAll } from "vitest";
import * as pulumi from "@pulumi/pulumi";

// Store created resources for assertions
const resources: Array<{ type: string; name: string; inputs: Record<string, unknown> }> = [];

// Set required config values BEFORE setting mocks
pulumi.runtime.setAllConfig({
    "infrastructure:githubOrg": "test-org",
    "infrastructure:githubRepo": "test-repo",
    "infrastructure:bitbucketWorkspaceUuid": "{test-uuid}",
    "infrastructure:bitbucketWorkspaceSlug": "test-workspace",
    "infrastructure:location": "eastus",
});

// Mock Pulumi runtime before importing the module
pulumi.runtime.setMocks(
    {
        newResource: (args: pulumi.runtime.MockResourceArgs): { id: string; state: Record<string, unknown> } => {
            resources.push({
                type: args.type,
                name: args.name,
                inputs: args.inputs,
            });
            return {
                id: `${args.name}-id`,
                state: {
                    ...args.inputs,
                    name: args.inputs.resourceGroupName || args.name,
                    loginServer: "mockacr.azurecr.io",
                    principalId: "mock-principal-id",
                    clientId: "mock-client-id",
                },
            };
        },
        call: (args: pulumi.runtime.MockCallArgs): Record<string, unknown> => {
            if (args.token === "azure-native:authorization:getClientConfig") {
                return {
                    subscriptionId: "mock-subscription-id",
                    tenantId: "mock-tenant-id",
                };
            }
            return {};
        },
    },
    "infrastructure",
    "test",
    false
);

// Helper function to convert pulumi.Output to a promise
function promiseOf<T>(output: pulumi.Output<T>): Promise<T> {
    return new Promise(resolve => output.apply(resolve));
}

describe("Infrastructure", () => {
    let infra: typeof import("./index");

    beforeAll(async () => {
        infra = await import("./index");
        // Wait for all resources to be created by resolving all outputs
        await Promise.all([
            promiseOf(infra.resourceGroupName),
            promiseOf(infra.environmentId),
            promiseOf(infra.environmentName),
            promiseOf(infra.acrLoginServer),
            promiseOf(infra.acrName),
            promiseOf(infra.deployIdentityId),
            promiseOf(infra.deployIdentityClientId),
            promiseOf(infra.deployIdentityPrincipalId),
        ]);
    });

    describe("Resource Group", () => {
        it("creates a resource group with correct tags", () => {
            const rg = resources.find(r => r.type === "azure-native:resources:ResourceGroup");
            expect(rg).toBeDefined();
            expect(rg?.inputs.tags).toMatchObject({
                managedBy: "pulumi",
                purpose: "shared-infrastructure",
            });
        });
    });

    describe("Container Registry", () => {
        it("creates an ACR with Basic SKU", () => {
            const acr = resources.find(r => r.type === "azure-native:containerregistry:Registry");
            expect(acr).toBeDefined();
            expect(acr?.inputs.sku).toEqual({ name: "Basic" });
        });

        it("disables admin user on ACR", () => {
            const acr = resources.find(r => r.type === "azure-native:containerregistry:Registry");
            expect(acr?.inputs.adminUserEnabled).toBe(false);
        });
    });

    describe("Container Apps Environment", () => {
        it("creates a managed environment", () => {
            const env = resources.find(r => r.type === "azure-native:app:ManagedEnvironment");
            expect(env).toBeDefined();
            expect(env?.inputs.tags).toMatchObject({ managedBy: "pulumi" });
        });
    });

    describe("Managed Identity", () => {
        it("creates a user-assigned identity", () => {
            const identity = resources.find(r => r.type === "azure-native:managedidentity:UserAssignedIdentity");
            expect(identity).toBeDefined();
            expect(identity?.inputs.tags).toMatchObject({
                managedBy: "pulumi",
                purpose: "cicd-deployment",
            });
        });
    });

    describe("Custom RBAC Roles", () => {
        it("creates Container Apps Deployer custom role", () => {
            const roles = resources.filter(r => r.type === "azure-native:authorization:RoleDefinition");
            const containerAppsRole = roles.find(r => r.name === "container-apps-deploy");
            expect(containerAppsRole).toBeDefined();
            expect(containerAppsRole?.inputs.roleName).toBe("Container Apps Deployer");
        });

        it("creates Registry Image Pusher custom role", () => {
            const roles = resources.filter(r => r.type === "azure-native:authorization:RoleDefinition");
            const registryRole = roles.find(r => r.name === "registry-pusher");
            expect(registryRole).toBeDefined();
            expect(registryRole?.inputs.roleName).toBe("Registry Image Pusher");
        });
    });

    describe("OIDC Federation", () => {
        it("creates federated credential for GitHub Actions", () => {
            const federations = resources.filter(r => r.type === "azure-native:managedidentity:FederatedIdentityCredential");
            const github = federations.find(r => r.name === "github-federation");
            expect(github).toBeDefined();
            expect(github?.inputs.issuer).toBe("https://token.actions.githubusercontent.com");
            expect(github?.inputs.subject).toContain("test-org/test-repo");
            expect(github?.inputs.audiences).toContain("api://AzureADTokenExchange");
        });

        it("creates federated credential for Bitbucket Pipelines", () => {
            const federations = resources.filter(r => r.type === "azure-native:managedidentity:FederatedIdentityCredential");
            const bitbucket = federations.find(r => r.name === "bitbucket-federation");
            expect(bitbucket).toBeDefined();
            expect(bitbucket?.inputs.issuer).toContain("api.bitbucket.org");
            expect(bitbucket?.inputs.issuer).toContain("test-workspace");
            expect(bitbucket?.inputs.subject).toBe("{test-uuid}");
        });
    });

    describe("Role Assignments", () => {
        it("creates Container Apps Deployer role assignment", () => {
            const roles = resources.filter(r => r.type === "azure-native:authorization:RoleAssignment");
            const containerApps = roles.find(r => r.name === "container-apps-deploy");
            expect(containerApps).toBeDefined();
        });

        it("creates Registry Pusher role assignment", () => {
            const roles = resources.filter(r => r.type === "azure-native:authorization:RoleAssignment");
            const registry = roles.find(r => r.name === "registry-pusher");
            expect(registry).toBeDefined();
        });

        it("scopes role assignments appropriately (not subscription-level)", () => {
            const roles = resources.filter(r => r.type === "azure-native:authorization:RoleAssignment");
            for (const role of roles) {
                const scope = role?.inputs.scope as string;
                expect(scope).toBeDefined();
                // Should NOT be subscription-level (subscription ID only)
                expect(scope).not.toMatch(/^\/subscriptions\/[^/]+$/);
            }
        });
    });

    describe("Exports", () => {
        it("exports resourceGroupName", async () => {
            const value = await promiseOf(infra.resourceGroupName);
            expect(value).toBeDefined();
        });

        it("exports acrLoginServer", async () => {
            const value = await promiseOf(infra.acrLoginServer);
            expect(value).toBeDefined();
        });

        it("exports environmentId", async () => {
            const value = await promiseOf(infra.environmentId);
            expect(value).toBeDefined();
        });

        it("exports custom role IDs", async () => {
            const containerAppsRoleId = await promiseOf(infra.containerAppsDeployRoleId);
            const registryRoleId = await promiseOf(infra.registryPusherRoleId);
            expect(containerAppsRoleId).toBeDefined();
            expect(registryRoleId).toBeDefined();
        });
    });
});
