import * as pulumi from "@pulumi/pulumi";
import * as azure from "@pulumi/azure-native";

const config = new pulumi.Config();
const appName = config.require("appName");
const imageTag = config.require("imageTag");
const cpuLimit = config.getNumber("cpuLimit") || 1;
const memoryLimit = config.get("memoryLimit") || "2Gi";
const targetPort = config.getNumber("targetPort") || 8080;
const healthPath = config.get("healthPath") || "/health";

// Stack name is the normalized branch name
const stack = pulumi.getStack();
const serviceName = `${appName}-${stack}`;

// Reference shared infrastructure
const infraStackRef = config.require("infraStackRef");
const infraStack = new pulumi.StackReference(infraStackRef);
const environmentId = infraStack.requireOutput("environmentId");
const acrLoginServer = infraStack.requireOutput("acrLoginServer");
const resourceGroupName = infraStack.requireOutput("resourceGroupName") as pulumi.Output<string>;

// Container App (deployed to shared resource group)
const app = new azure.app.ContainerApp(serviceName, {
    resourceGroupName: resourceGroupName,
    managedEnvironmentId: environmentId,

    configuration: {
        ingress: {
            external: true,
            targetPort,
            transport: "http",
            allowInsecure: false,
        },
        registries: [{
            server: acrLoginServer,
            identity: "system",
        }],
    },

    template: {
        containers: [{
            name: appName,
            image: pulumi.interpolate`${acrLoginServer}/${appName}:${imageTag}`,
            resources: {
                cpu: cpuLimit,
                memory: memoryLimit,
            },
            probes: [
                {
                    type: "Startup",
                    httpGet: {
                        path: healthPath,
                        port: targetPort,
                    },
                    initialDelaySeconds: 0,
                    periodSeconds: 3,
                    failureThreshold: 30,
                },
                {
                    type: "Readiness",
                    httpGet: {
                        path: healthPath,
                        port: targetPort,
                    },
                    initialDelaySeconds: 5,
                    periodSeconds: 10,
                    failureThreshold: 3,
                },
                {
                    type: "Liveness",
                    httpGet: {
                        path: healthPath,
                        port: targetPort,
                    },
                    initialDelaySeconds: 30,
                    periodSeconds: 30,
                    failureThreshold: 3,
                },
            ],
        }],
        scale: {
            minReplicas: 0,
            maxReplicas: 100,
            rules: [{
                name: "http-scaling",
                http: {
                    metadata: {
                        concurrentRequests: "80",
                    },
                },
            }],
        },
    },

    identity: {
        type: "SystemAssigned",
    },

    tags: {
        app: appName,
        branch: stack,
        managedBy: "pulumi",
    },
});

// Exports
export const url = pulumi.interpolate`https://${app.configuration.apply(c => c?.ingress?.fqdn)}`;
export { resourceGroupName };
export const containerAppName = app.name;
