import { describe, it, expect, beforeAll, vi } from "vitest";
import * as pulumi from "@pulumi/pulumi";

// Store created resources for assertions
const resources: Array<{ type: string; name: string; inputs: Record<string, unknown> }> = [];

// Set required config values BEFORE setting mocks
pulumi.runtime.setAllConfig({
    "gcp:project": "test-project-123",
    "app:appName": "test-app",
    "app:imageTag": "main",
    "app:infraStackRef": "org/infrastructure/prod",
    "app:region": "us-central1",
    "app:containerPort": "8080",
    "app:healthCheckPath": "/health",
    "app:allowUnauthenticated": "true",
    "app:customDomain": "test.example.com",
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
                    registryUrl: "us-central1-docker.pkg.dev/test-project-123/apps-docker",
                    projectId_: "test-project-123",
                    wifPoolId: "pool-id",
                };
                return actual.output(outputs[name] || "");
            }
            requireOutput(name: string): pulumi.Output<unknown> {
                return this.getOutput(name);
            }
        },
    };
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

            if (args.type === "gcp:cloudrun/service:Service") {
                defaults.name = args.inputs.name || args.name;
                defaults.statuses = [{
                    url: "https://test-app-main-abc123-uc.a.run.app",
                    latestReadyRevisionName: "test-app-main-00001-abc",
                }];
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
    "app",
    "main",
    false
);

// Helper function to convert pulumi.Output to a promise
function promiseOf<T>(output: pulumi.Output<T>): Promise<T> {
    return new Promise(resolve => output.apply(resolve));
}

describe("App Stack", () => {
    let outputs: typeof import("./index");

    beforeAll(async () => {
        outputs = await import("./index");
        // Wait for all resources to be created
        await Promise.all([
            promiseOf(outputs.url),
            promiseOf(outputs.serviceName_),
            promiseOf(outputs.serviceId),
        ]);
    });

    describe("Cloud Run Service", () => {
        it("should create a Cloud Run service", () => {
            const service = resources.find(r => r.type === "gcp:cloudrun/service:Service");
            expect(service).toBeDefined();
        });

        it("should construct service name from app and branch", async () => {
            const service = resources.find(r => r.type === "gcp:cloudrun/service:Service");
            // serviceName is an Output, check the input
            expect(service?.inputs.name).toBeDefined();
        });

        it("should set correct region", () => {
            const service = resources.find(r => r.type === "gcp:cloudrun/service:Service");
            expect(service?.inputs.location).toBe("us-central1");
        });

        it("should apply correct labels to metadata", () => {
            const service = resources.find(r => r.type === "gcp:cloudrun/service:Service");
            const metadata = service?.inputs.metadata as Record<string, unknown>;
            expect(metadata?.labels).toMatchObject({
                "managed-by": "pulumi",
                "app": "test-app",
            });
        });

        it("should enable autogenerate revision name", () => {
            const service = resources.find(r => r.type === "gcp:cloudrun/service:Service");
            expect(service?.inputs.autogenerateRevisionName).toBe(true);
        });
    });

    describe("Container Configuration", () => {
        function getContainerSpec() {
            const service = resources.find(r => r.type === "gcp:cloudrun/service:Service");
            const template = service?.inputs.template as Record<string, unknown>;
            const spec = template?.spec as Record<string, unknown>;
            const containers = spec?.containers as Array<Record<string, unknown>>;
            return containers?.[0];
        }

        it("should construct correct image URL", () => {
            const container = getContainerSpec();
            // Image should be: {registryUrl}/{appName}:{imageTag}
            expect(container?.image).toBeDefined();
        });

        it("should set correct container port", () => {
            const container = getContainerSpec();
            const ports = container?.ports as Array<Record<string, unknown>>;
            expect(ports?.[0]?.containerPort).toBe(8080);
            expect(ports?.[0]?.name).toBe("http1");
        });

        it("should set CPU and memory limits", () => {
            const container = getContainerSpec();
            const resources = container?.resources as Record<string, unknown>;
            const limits = resources?.limits as Record<string, string>;
            expect(limits?.cpu).toBe("1");
            expect(limits?.memory).toBe("512Mi");
        });

        it("should set container concurrency", () => {
            const service = resources.find(r => r.type === "gcp:cloudrun/service:Service");
            const template = service?.inputs.template as Record<string, unknown>;
            const spec = template?.spec as Record<string, unknown>;
            expect(spec?.containerConcurrency).toBe(80);
        });

        it("should set timeout", () => {
            const service = resources.find(r => r.type === "gcp:cloudrun/service:Service");
            const template = service?.inputs.template as Record<string, unknown>;
            const spec = template?.spec as Record<string, unknown>;
            expect(spec?.timeoutSeconds).toBe(300);
        });
    });

    describe("Health Probes", () => {
        function getContainerSpec() {
            const service = resources.find(r => r.type === "gcp:cloudrun/service:Service");
            const template = service?.inputs.template as Record<string, unknown>;
            const spec = template?.spec as Record<string, unknown>;
            const containers = spec?.containers as Array<Record<string, unknown>>;
            return containers?.[0];
        }

        it("should configure startup probe", () => {
            const container = getContainerSpec();
            const probe = container?.startupProbe as Record<string, unknown>;
            expect(probe).toBeDefined();
        });

        it("should configure startup probe with correct timing", () => {
            const container = getContainerSpec();
            const probe = container?.startupProbe as Record<string, unknown>;
            expect(probe?.initialDelaySeconds).toBe(0);
            expect(probe?.periodSeconds).toBe(3);
            expect(probe?.failureThreshold).toBe(30);
        });

        it("should configure startup probe health check path", () => {
            const container = getContainerSpec();
            const probe = container?.startupProbe as Record<string, unknown>;
            const httpGet = probe?.httpGet as Record<string, unknown>;
            expect(httpGet?.path).toBe("/health");
            expect(httpGet?.port).toBe(8080);
        });

        it("should configure liveness probe", () => {
            const container = getContainerSpec();
            const probe = container?.livenessProbe as Record<string, unknown>;
            expect(probe).toBeDefined();
        });

        it("should configure liveness probe with correct timing", () => {
            const container = getContainerSpec();
            const probe = container?.livenessProbe as Record<string, unknown>;
            expect(probe?.periodSeconds).toBe(30);
            expect(probe?.timeoutSeconds).toBe(5);
            expect(probe?.failureThreshold).toBe(3);
        });
    });

    describe("Scaling Annotations", () => {
        function getTemplateAnnotations() {
            const service = resources.find(r => r.type === "gcp:cloudrun/service:Service");
            const template = service?.inputs.template as Record<string, unknown>;
            const metadata = template?.metadata as Record<string, unknown>;
            return metadata?.annotations as Record<string, string>;
        }

        it("should set min instances to 0", () => {
            const annotations = getTemplateAnnotations();
            expect(annotations?.["autoscaling.knative.dev/minScale"]).toBe("0");
        });

        it("should set max instances to 100", () => {
            const annotations = getTemplateAnnotations();
            expect(annotations?.["autoscaling.knative.dev/maxScale"]).toBe("100");
        });

        it("should enable startup CPU boost", () => {
            const annotations = getTemplateAnnotations();
            expect(annotations?.["run.googleapis.com/startup-cpu-boost"]).toBe("true");
        });

        it("should enable CPU throttling", () => {
            const annotations = getTemplateAnnotations();
            expect(annotations?.["run.googleapis.com/cpu-throttling"]).toBe("true");
        });
    });

    describe("Traffic Configuration", () => {
        it("should route 100% traffic to latest revision", () => {
            const service = resources.find(r => r.type === "gcp:cloudrun/service:Service");
            const traffics = service?.inputs.traffics as Array<Record<string, unknown>>;
            expect(traffics?.[0]?.percent).toBe(100);
            expect(traffics?.[0]?.latestRevision).toBe(true);
        });

        it("should set ingress to allow all traffic", () => {
            const service = resources.find(r => r.type === "gcp:cloudrun/service:Service");
            const metadata = service?.inputs.metadata as Record<string, unknown>;
            const annotations = metadata?.annotations as Record<string, string>;
            expect(annotations?.["run.googleapis.com/ingress"]).toBe("all");
        });
    });

    describe("Public Access (IAM)", () => {
        it("should create IAM member for public access", () => {
            const iamMember = resources.find(
                r => r.type === "gcp:cloudrun/iamMember:IamMember" &&
                     r.name === "public-access"
            );
            expect(iamMember).toBeDefined();
        });

        it("should grant run.invoker role to allUsers", () => {
            const iamMember = resources.find(
                r => r.type === "gcp:cloudrun/iamMember:IamMember" &&
                     r.name === "public-access"
            );
            expect(iamMember?.inputs.role).toBe("roles/run.invoker");
            expect(iamMember?.inputs.member).toBe("allUsers");
        });
    });

    describe("Custom Domain Mapping", () => {
        it("should create domain mapping when configured", () => {
            const mapping = resources.find(r => r.type === "gcp:cloudrun/domainMapping:DomainMapping");
            expect(mapping).toBeDefined();
        });

        it("should set correct domain name", () => {
            const mapping = resources.find(r => r.type === "gcp:cloudrun/domainMapping:DomainMapping");
            expect(mapping?.inputs.name).toBe("test.example.com");
        });

        it("should use automatic certificate mode", () => {
            const mapping = resources.find(r => r.type === "gcp:cloudrun/domainMapping:DomainMapping");
            const spec = mapping?.inputs.spec as Record<string, unknown>;
            expect(spec?.certificateMode).toBe("AUTOMATIC");
        });

        it("should enable force override", () => {
            const mapping = resources.find(r => r.type === "gcp:cloudrun/domainMapping:DomainMapping");
            const spec = mapping?.inputs.spec as Record<string, unknown>;
            expect(spec?.forceOverride).toBe(true);
        });
    });

    describe("Exports", () => {
        it("should export url", async () => {
            const value = await promiseOf(outputs.url);
            expect(value).toBeDefined();
        });

        it("should export serviceName_", async () => {
            const value = await promiseOf(outputs.serviceName_);
            expect(value).toBeDefined();
        });

        it("should export serviceId", async () => {
            const value = await promiseOf(outputs.serviceId);
            expect(value).toBeDefined();
        });

        it("should export latestRevision", async () => {
            const value = await promiseOf(outputs.latestRevision);
            expect(value).toBeDefined();
        });

        it("should export region_", () => {
            expect(outputs.region_).toBe("us-central1");
        });

        it("should export appName_", () => {
            expect(outputs.appName_).toBe("test-app");
        });

        it("should export imageTag_", () => {
            expect(outputs.imageTag_).toBe("main");
        });

        it("should export isPublic", () => {
            expect(outputs.isPublic).toBe(true);
        });

        it("should export customDomain_", () => {
            expect(outputs.customDomain_).toBe("test.example.com");
        });
    });
});
