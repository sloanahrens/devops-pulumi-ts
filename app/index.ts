import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";

const config = new pulumi.Config();
const gcpConfig = new pulumi.Config("gcp");

// Required configuration
const appName = config.require("appName");
const imageTag = config.require("imageTag"); // Normalized branch name
const infraStackRef = config.require("infraStackRef");

// Optional configuration with defaults
const region = config.get("region") || "us-central1";
const cpuLimit = config.get("cpuLimit") || "1";
const memoryLimit = config.get("memoryLimit") || "512Mi";
const minInstances = config.getNumber("minInstances") ?? 0;
const maxInstances = config.getNumber("maxInstances") ?? 100;
const containerConcurrency = config.getNumber("containerConcurrency") ?? 80;
const containerPort = config.getNumber("containerPort") ?? 8080;
const allowUnauthenticated = config.getBoolean("allowUnauthenticated") ?? true;
const healthCheckPath = config.get("healthCheckPath") || "/health";
const startupCpuBoost = config.getBoolean("startupCpuBoost") ?? true;
const cpuThrottling = config.getBoolean("cpuThrottling") ?? true;

// Optional runtime service account for apps with backend resources (Firestore, Secret Manager, etc.)
// If not provided, Cloud Run uses the default compute service account
const runtimeServiceAccountEmail = config.get("runtimeServiceAccountEmail");

// Reference shared infrastructure stack
const infra = new pulumi.StackReference(infraStackRef);
const registryUrl = infra.requireOutput("registryUrl");
const projectId = infra.requireOutput("projectId_");

// Common labels
const commonLabels = {
    "managed-by": "pulumi",
    "app": appName,
    "branch": imageTag,
    "stack": pulumi.getStack(),
};

// Construct service name (max 63 chars for Cloud Run)
const serviceName = pulumi.interpolate`${appName}-${imageTag}`.apply(name => {
    if (name.length > 63) {
        // Truncate and add hash to avoid collisions
        const crypto = require("crypto");
        const hash = crypto.createHash("md5").update(name).digest("hex").substring(0, 6);
        return name.substring(0, 56) + "-" + hash;
    }
    return name;
});

// Cloud Run service
const service = new gcp.cloudrun.Service("app", {
    name: serviceName,
    location: region,
    template: {
        spec: {
            containers: [{
                image: pulumi.interpolate`${registryUrl}/${appName}:${imageTag}`,
                ports: [{
                    containerPort: containerPort,
                    name: "http1",
                }],
                resources: {
                    limits: {
                        cpu: cpuLimit,
                        memory: memoryLimit,
                    },
                },
                // Startup probe
                startupProbe: {
                    httpGet: {
                        path: healthCheckPath,
                        port: containerPort,
                    },
                    initialDelaySeconds: 0,
                    periodSeconds: 3,
                    timeoutSeconds: 1,
                    failureThreshold: 30, // 90 seconds max startup time
                },
                // Liveness probe
                livenessProbe: {
                    httpGet: {
                        path: healthCheckPath,
                        port: containerPort,
                    },
                    periodSeconds: 30,
                    timeoutSeconds: 5,
                    failureThreshold: 3,
                },
            }],
            containerConcurrency: containerConcurrency,
            timeoutSeconds: 300,
            // Use app-provided runtime SA if specified, otherwise default compute SA
            serviceAccountName: runtimeServiceAccountEmail || undefined,
        },
        metadata: {
            annotations: {
                "autoscaling.knative.dev/minScale": String(minInstances),
                "autoscaling.knative.dev/maxScale": String(maxInstances),
                "run.googleapis.com/startup-cpu-boost": startupCpuBoost ? "true" : "false",
                "run.googleapis.com/cpu-throttling": cpuThrottling ? "true" : "false",
            },
            labels: commonLabels,
        },
    },
    traffics: [{
        percent: 100,
        latestRevision: true,
    }],
    metadata: {
        labels: commonLabels,
        annotations: {
            "run.googleapis.com/ingress": "all",
        },
    },
    autogenerateRevisionName: true,
});

// IAM binding for public access (if enabled)
let iamMember: gcp.cloudrun.IamMember | undefined;
if (allowUnauthenticated) {
    iamMember = new gcp.cloudrun.IamMember("public-access", {
        service: service.name,
        location: region,
        role: "roles/run.invoker",
        member: "allUsers",
    });
}

// Outputs
export const url = service.statuses.apply(statuses =>
    statuses && statuses[0] ? statuses[0].url : "pending"
);
export const serviceName_ = service.name;
export const serviceId = service.id;
export const latestRevision = service.statuses.apply(statuses =>
    statuses && statuses[0] ? statuses[0].latestReadyRevisionName : "pending"
);
export const projectId_ = projectId;
export const region_ = region;
export const appName_ = appName;
export const imageTag_ = imageTag;
export const isPublic = allowUnauthenticated;
export const runtimeServiceAccount = runtimeServiceAccountEmail || "default-compute";

// Deployment summary
export const deploymentSummary = pulumi.interpolate`
Deployment complete!

Service: ${service.name}
URL: ${url}
Revision: ${latestRevision}
Image: ${registryUrl}/${appName}:${imageTag}
Public: ${allowUnauthenticated ? "yes" : "no"}
Runtime SA: ${runtimeServiceAccountEmail || "default-compute"}

Resources:
  CPU: ${cpuLimit}
  Memory: ${memoryLimit}
  Min Instances: ${minInstances}
  Max Instances: ${maxInstances}
`;
