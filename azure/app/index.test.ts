import { describe, it, expect, beforeAll, vi } from "vitest";
import * as pulumi from "@pulumi/pulumi";

// Store created resources for assertions
const resources: Array<{ type: string; name: string; inputs: Record<string, unknown> }> = [];

// Set required config values BEFORE setting mocks
pulumi.runtime.setAllConfig({
    "app:appName": "test-app",
    "app:imageTag": "v1.0.0",
    "app:infraStackRef": "org/infrastructure/prod",
    "app:targetPort": "8080",
    "app:healthPath": "/health",
});

// Mock StackReference before setting up mocks
vi.mock("@pulumi/pulumi", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@pulumi/pulumi")>();
    return {
        ...actual,
        StackReference: class MockStackReference {
            constructor(_name: string) {}
            getOutput(name: string): pulumi.Output<unknown> {
                const outputs: Record<string, string> = {
                    environmentId: "/subscriptions/sub/resourceGroups/rg/providers/Microsoft.App/managedEnvironments/env",
                    acrLoginServer: "mockacr.azurecr.io",
                    resourceGroupName: "devops-shared-rg",
                };
                return actual.output(outputs[name] || "");
            }
            requireOutput(name: string): pulumi.Output<unknown> {
                return this.getOutput(name);
            }
        },
    };
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
                    name: args.inputs.containerAppName || args.name,
                    configuration: {
                        ...((args.inputs.configuration as Record<string, unknown>) || {}),
                        ingress: {
                            ...((args.inputs.configuration as Record<string, unknown>)?.ingress as Record<string, unknown> || {}),
                            fqdn: "test-app.azurecontainerapps.io",
                        },
                    },
                },
            };
        },
        call: (args: pulumi.runtime.MockCallArgs): Record<string, unknown> => {
            return {};
        },
    },
    "app",
    "main",
    false
);

// Helper function to convert pulumi.Output to a promise
function promiseOf<T>(output: pulumi.Output<T>): Promise<T> {
    return new Promise(resolve => output.apply(resolve));
}

describe("App", () => {
    let app: typeof import("./index");

    beforeAll(async () => {
        app = await import("./index");
        // Wait for all resources to be created by resolving all outputs
        await Promise.all([
            promiseOf(app.url),
            promiseOf(app.resourceGroupName),
            promiseOf(app.containerAppName),
        ]);
    });

    describe("Container App", () => {
        it("creates a container app", () => {
            const containerApp = resources.find(r => r.type === "azure-native:app:ContainerApp");
            expect(containerApp).toBeDefined();
        });

        it("configures external ingress", () => {
            const containerApp = resources.find(r => r.type === "azure-native:app:ContainerApp");
            const config = containerApp?.inputs.configuration as Record<string, unknown>;
            const ingress = config?.ingress as Record<string, unknown>;
            expect(ingress?.external).toBe(true);
        });

        it("sets correct target port", () => {
            const containerApp = resources.find(r => r.type === "azure-native:app:ContainerApp");
            const config = containerApp?.inputs.configuration as Record<string, unknown>;
            const ingress = config?.ingress as Record<string, unknown>;
            expect(ingress?.targetPort).toBe(8080);
        });

        it("disables insecure connections", () => {
            const containerApp = resources.find(r => r.type === "azure-native:app:ContainerApp");
            const config = containerApp?.inputs.configuration as Record<string, unknown>;
            const ingress = config?.ingress as Record<string, unknown>;
            expect(ingress?.allowInsecure).toBe(false);
        });

        it("configures registry with system identity", () => {
            const containerApp = resources.find(r => r.type === "azure-native:app:ContainerApp");
            const config = containerApp?.inputs.configuration as Record<string, unknown>;
            const registries = config?.registries as Array<{ identity: string }>;
            expect(registries?.[0]?.identity).toBe("system");
        });

        it("applies correct tags", () => {
            const containerApp = resources.find(r => r.type === "azure-native:app:ContainerApp");
            expect(containerApp?.inputs.tags).toMatchObject({
                app: "test-app",
                branch: "main",
                managedBy: "pulumi",
            });
        });
    });

    describe("Container Resources", () => {
        it("uses default CPU limit of 1", () => {
            const containerApp = resources.find(r => r.type === "azure-native:app:ContainerApp");
            const template = containerApp?.inputs.template as Record<string, unknown>;
            const containers = template?.containers as Array<{ resources: { cpu: number } }>;
            expect(containers?.[0]?.resources?.cpu).toBe(1);
        });

        it("uses default memory limit of 2Gi", () => {
            const containerApp = resources.find(r => r.type === "azure-native:app:ContainerApp");
            const template = containerApp?.inputs.template as Record<string, unknown>;
            const containers = template?.containers as Array<{ resources: { memory: string } }>;
            expect(containers?.[0]?.resources?.memory).toBe("2Gi");
        });

        it("constructs correct image URL format", () => {
            const containerApp = resources.find(r => r.type === "azure-native:app:ContainerApp");
            const template = containerApp?.inputs.template as Record<string, unknown>;
            const containers = template?.containers as Array<{ image: string }>;
            // Image should be: {acrLoginServer}/{appName}:{imageTag}
            expect(containers?.[0]?.image).toMatch(/^mockacr\.azurecr\.io\/test-app:v1\.0\.0$/);
        });
    });

    describe("Health Probes", () => {
        function getProbes() {
            const containerApp = resources.find(r => r.type === "azure-native:app:ContainerApp");
            const template = containerApp?.inputs.template as Record<string, unknown>;
            const containers = template?.containers as Array<{ probes: Array<Record<string, unknown>> }>;
            return containers?.[0]?.probes || [];
        }

        it("configures startup probe", () => {
            const probes = getProbes();
            const startupProbe = probes.find(p => p.type === "Startup");
            expect(startupProbe).toBeDefined();
        });

        it("configures startup probe with correct timing", () => {
            const probes = getProbes();
            const startupProbe = probes.find(p => p.type === "Startup");
            expect(startupProbe?.initialDelaySeconds).toBe(0);
            expect(startupProbe?.periodSeconds).toBe(3);
            expect(startupProbe?.failureThreshold).toBe(30);
        });

        it("configures readiness probe", () => {
            const probes = getProbes();
            const readinessProbe = probes.find(p => p.type === "Readiness");
            expect(readinessProbe).toBeDefined();
        });

        it("configures readiness probe with correct timing", () => {
            const probes = getProbes();
            const readinessProbe = probes.find(p => p.type === "Readiness");
            expect(readinessProbe?.initialDelaySeconds).toBe(5);
            expect(readinessProbe?.periodSeconds).toBe(10);
            expect(readinessProbe?.failureThreshold).toBe(3);
        });

        it("configures liveness probe", () => {
            const probes = getProbes();
            const livenessProbe = probes.find(p => p.type === "Liveness");
            expect(livenessProbe).toBeDefined();
        });

        it("configures liveness probe with correct timing", () => {
            const probes = getProbes();
            const livenessProbe = probes.find(p => p.type === "Liveness");
            expect(livenessProbe?.initialDelaySeconds).toBe(30);
            expect(livenessProbe?.periodSeconds).toBe(30);
            expect(livenessProbe?.failureThreshold).toBe(3);
        });

        it("all probes use the health endpoint", () => {
            const probes = getProbes();
            for (const probe of probes) {
                const httpGet = probe.httpGet as Record<string, unknown>;
                expect(httpGet?.path).toBe("/health");
                expect(httpGet?.port).toBe(8080);
            }
        });
    });

    describe("Scaling", () => {
        function getScale() {
            const containerApp = resources.find(r => r.type === "azure-native:app:ContainerApp");
            const template = containerApp?.inputs.template as Record<string, unknown>;
            return template?.scale as Record<string, unknown>;
        }

        it("sets minReplicas to 0 (scale to zero)", () => {
            const scale = getScale();
            expect(scale?.minReplicas).toBe(0);
        });

        it("sets maxReplicas to 100", () => {
            const scale = getScale();
            expect(scale?.maxReplicas).toBe(100);
        });

        it("configures HTTP scaling rule", () => {
            const scale = getScale();
            const rules = scale?.rules as Array<Record<string, unknown>>;
            const httpRule = rules?.find(r => r.name === "http-scaling");
            expect(httpRule).toBeDefined();
        });

        it("sets concurrent requests threshold to 80", () => {
            const scale = getScale();
            const rules = scale?.rules as Array<Record<string, unknown>>;
            const httpRule = rules?.find(r => r.name === "http-scaling");
            const http = httpRule?.http as Record<string, unknown>;
            const metadata = http?.metadata as Record<string, string>;
            expect(metadata?.concurrentRequests).toBe("80");
        });
    });

    describe("Identity", () => {
        it("uses SystemAssigned identity", () => {
            const containerApp = resources.find(r => r.type === "azure-native:app:ContainerApp");
            const identity = containerApp?.inputs.identity as Record<string, unknown>;
            expect(identity?.type).toBe("SystemAssigned");
        });
    });

    describe("Exports", () => {
        it("exports url", async () => {
            const value = await promiseOf(app.url);
            expect(value).toBeDefined();
        });

        it("exports resourceGroupName", async () => {
            const value = await promiseOf(app.resourceGroupName);
            expect(value).toBeDefined();
        });

        it("exports containerAppName", async () => {
            const value = await promiseOf(app.containerAppName);
            expect(value).toBeDefined();
        });
    });
});
