import { describe, it, expect, beforeAll } from "vitest";
import * as pulumi from "@pulumi/pulumi";

// Store created resources for assertions
const resources: Array<{ type: string; name: string; inputs: Record<string, unknown> }> = [];

// Mock Pulumi runtime
pulumi.runtime.setMocks(
    {
        newResource: (args: pulumi.runtime.MockResourceArgs) => {
            resources.push({
                type: args.type,
                name: args.name,
                inputs: args.inputs,
            });

            const defaults: Record<string, any> = {};

            if (args.type === "azure-native:resources:ResourceGroup") {
                defaults.name = args.name;
            }
            if (args.type === "azure-native:storage:StorageAccount") {
                defaults.name = args.inputs.accountName || args.name;
            }
            if (args.type === "azure-native:storage:BlobContainer") {
                defaults.name = args.inputs.containerName || args.name;
            }

            return {
                id: `${args.name}-id`,
                state: { ...args.inputs, ...defaults },
            };
        },
        call: (args: pulumi.runtime.MockCallArgs) => {
            if (args.token === "azure-native:authorization:getClientConfig") {
                return {
                    subscriptionId: "1701a012-37d6-4f88-b086-f98bbdf258f0",
                    tenantId: "mock-tenant-id",
                    clientId: "mock-client-id",
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

describe("Bootstrap Stack", () => {
    let outputs: typeof import("./index");

    beforeAll(async () => {
        outputs = await import("./index");
        // Wait for all resources to be created
        await Promise.all([
            promiseOf(outputs.resourceGroupName),
            promiseOf(outputs.storageAccountName),
            promiseOf(outputs.containerName),
            promiseOf(outputs.backendUrl),
        ]);
    });

    describe("Resource Group", () => {
        it("should create bootstrap resource group", async () => {
            const rg = resources.find(r => r.type === "azure-native:resources:ResourceGroup");
            expect(rg).toBeDefined();
            expect(rg?.name).toBe("devops-bootstrap-rg");
        });

        it("should apply correct tags", () => {
            const rg = resources.find(r => r.type === "azure-native:resources:ResourceGroup");
            expect(rg?.inputs.tags).toMatchObject({
                managedBy: "pulumi",
                purpose: "state-storage",
            });
        });
    });

    describe("Storage Account", () => {
        it("should derive name from subscription ID", async () => {
            const name = await promiseOf(outputs.storageAccountName);
            // Last 8 chars of 1701a012-37d6-4f88-b086-f98bbdf258f0 (no dashes) = bdf258f0
            expect(name).toBe("pulumistatebdf258f0");
        });

        it("should use Standard_LRS SKU", () => {
            const storage = resources.find(r => r.type === "azure-native:storage:StorageAccount");
            expect(storage?.inputs.sku).toEqual({ name: "Standard_LRS" });
        });

        it("should use StorageV2 kind", () => {
            const storage = resources.find(r => r.type === "azure-native:storage:StorageAccount");
            expect(storage?.inputs.kind).toBe("StorageV2");
        });

        it("should enforce HTTPS-only traffic", () => {
            const storage = resources.find(r => r.type === "azure-native:storage:StorageAccount");
            expect(storage?.inputs.enableHttpsTrafficOnly).toBe(true);
        });

        it("should enforce TLS 1.2 minimum", () => {
            const storage = resources.find(r => r.type === "azure-native:storage:StorageAccount");
            expect(storage?.inputs.minimumTlsVersion).toBe("TLS1_2");
        });

        it("should disable public blob access", () => {
            const storage = resources.find(r => r.type === "azure-native:storage:StorageAccount");
            expect(storage?.inputs.allowBlobPublicAccess).toBe(false);
        });

        it("should apply correct tags", () => {
            const storage = resources.find(r => r.type === "azure-native:storage:StorageAccount");
            expect(storage?.inputs.tags).toMatchObject({
                managedBy: "pulumi",
                purpose: "state-storage",
            });
        });
    });

    describe("Blob Container", () => {
        it("should create state container", async () => {
            const name = await promiseOf(outputs.containerName);
            expect(name).toBe("state");
        });

        it("should disable public access", () => {
            const container = resources.find(r => r.type === "azure-native:storage:BlobContainer");
            expect(container?.inputs.publicAccess).toBe("None");
        });
    });

    describe("Backend URL", () => {
        it("should output correct azblob URL format", async () => {
            const url = await promiseOf(outputs.backendUrl);
            expect(url).toMatch(/^azblob:\/\/state\?storage_account=pulumistate/);
        });
    });
});
