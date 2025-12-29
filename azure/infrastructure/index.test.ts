import { describe, it, expect, beforeAll } from "vitest";
import * as pulumi from "@pulumi/pulumi";

// Store created resources for assertions
const resources: Array<{ type: string; name: string; inputs: Record<string, unknown> }> = [];

// Set required config values BEFORE setting mocks
pulumi.runtime.setAllConfig({
    "infrastructure:githubOrg": "test-org",
    "infrastructure:githubRepo": "test-repo",
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
        // This forces Pulumi to evaluate the entire resource graph
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
                purpose: "github-actions-deployment",
            });
        });
    });

    describe("OIDC Federation", () => {
        it("creates federated credential for GitHub Actions", () => {
            const federation = resources.find(r => r.type === "azure-native:managedidentity:FederatedIdentityCredential");
            expect(federation).toBeDefined();
            expect(federation?.inputs.issuer).toBe("https://token.actions.githubusercontent.com");
            expect(federation?.inputs.subject).toContain("test-org/test-repo");
            expect(federation?.inputs.audiences).toContain("api://AzureADTokenExchange");
        });
    });

    describe("Role Assignments", () => {
        it("creates AcrPush role assignment", () => {
            const roles = resources.filter(r => r.type === "azure-native:authorization:RoleAssignment");
            const acrPush = roles.find(r => r.name === "acr-push");
            expect(acrPush).toBeDefined();
        });

        it("scopes AcrPush to the container registry", () => {
            const roles = resources.filter(r => r.type === "azure-native:authorization:RoleAssignment");
            const acrPush = roles.find(r => r.name === "acr-push");
            // Scope should be the ACR resource ID, not subscription
            expect(acrPush?.inputs.scope).not.toContain("/subscriptions/mock-subscription-id\"");
        });

        it("creates Contributor role assignment", () => {
            const roles = resources.filter(r => r.type === "azure-native:authorization:RoleAssignment");
            const contributor = roles.find(r => r.name === "contributor");
            expect(contributor).toBeDefined();
        });

        it("scopes Contributor to resource group (not subscription)", () => {
            const roles = resources.filter(r => r.type === "azure-native:authorization:RoleAssignment");
            const contributor = roles.find(r => r.name === "contributor");
            // Security: Contributor should be scoped to RG, not subscription level
            // Subscription-level scope would be just "/subscriptions/{id}"
            const scope = contributor?.inputs.scope as string;
            expect(scope).toBeDefined();
            // Should NOT be subscription-level (subscription ID only)
            expect(scope).not.toMatch(/^\/subscriptions\/[^/]+$/);
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
    });
});
