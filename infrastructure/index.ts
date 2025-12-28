import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";
import { createCustomRoles } from "./roles";

const config = new pulumi.Config();
const gcpConfig = new pulumi.Config("gcp");

const projectId = gcpConfig.require("project");
const region = config.get("region") || "us-central1";
const deployServiceAccountEmail = config.require("deployServiceAccountEmail");
const bitbucketWorkspaceUuid = config.require("bitbucketWorkspaceUuid");

// Common labels for all resources
const commonLabels = {
    "managed-by": "pulumi",
    "purpose": "shared-infrastructure",
    "stack": pulumi.getStack(),
};

// Enable required APIs
const artifactRegistryApi = new gcp.projects.Service("artifactregistry-api", {
    service: "artifactregistry.googleapis.com",
    disableOnDestroy: false,
});

const runApi = new gcp.projects.Service("run-api", {
    service: "run.googleapis.com",
    disableOnDestroy: false,
});

const iamCredentialsApi = new gcp.projects.Service("iamcredentials-api", {
    service: "iamcredentials.googleapis.com",
    disableOnDestroy: false,
});

const stsApi = new gcp.projects.Service("sts-api", {
    service: "sts.googleapis.com",
    disableOnDestroy: false,
});

// Artifact Registry for Docker images
const registry = new gcp.artifactregistry.Repository("apps-docker", {
    repositoryId: "apps-docker",
    format: "DOCKER",
    location: region,
    description: "Docker images for Cloud Run applications",
    labels: commonLabels,
}, { dependsOn: [artifactRegistryApi] });

// Workload Identity Pool for Bitbucket OIDC
const wifPool = new gcp.iam.WorkloadIdentityPool("bitbucket-pool", {
    workloadIdentityPoolId: "bitbucket-deployments",
    displayName: "Bitbucket Deployments",
    description: "Workload Identity Pool for Bitbucket Pipelines OIDC authentication",
}, { dependsOn: [iamCredentialsApi, stsApi] });

// Workload Identity Provider (Bitbucket OIDC issuer)
const wifProvider = new gcp.iam.WorkloadIdentityPoolProvider("bitbucket-provider", {
    workloadIdentityPoolId: wifPool.workloadIdentityPoolId,
    workloadIdentityPoolProviderId: "bitbucket",
    displayName: "Bitbucket OIDC Provider",
    description: "OIDC provider for Bitbucket Pipelines",
    oidc: {
        issuerUri: `https://api.bitbucket.org/2.0/workspaces/${bitbucketWorkspaceUuid}/pipelines-config/identity/oidc`,
    },
    attributeMapping: {
        "google.subject": "assertion.sub",
        "attribute.repository_uuid": "assertion.repositoryUuid",
        "attribute.workspace_uuid": "assertion.workspaceUuid",
        "attribute.pipeline_uuid": "assertion.pipelineUuid",
        "attribute.step_uuid": "assertion.stepUuid",
    },
    attributeCondition: `assertion.workspaceUuid == "${bitbucketWorkspaceUuid}"`,
});

// IAM binding - allow WIF to impersonate deploy service account
const wifSaBinding = new gcp.serviceaccount.IAMBinding("wif-sa-binding", {
    serviceAccountId: `projects/${projectId}/serviceAccounts/${deployServiceAccountEmail}`,
    role: "roles/iam.workloadIdentityUser",
    members: [
        pulumi.interpolate`principalSet://iam.googleapis.com/${wifPool.name}/*`,
    ],
});

// Create custom IAM roles with minimal permissions
const customRoles = createCustomRoles(projectId);

// Grant custom Cloud Run deploy role (replaces roles/run.admin)
const runDeployBinding = new gcp.projects.IAMMember("deploy-run-custom", {
    project: projectId,
    role: customRoles.cloudRunDeploy.name,
    member: `serviceAccount:${deployServiceAccountEmail}`,
}, { dependsOn: [customRoles.cloudRunDeploy, runApi] });

// Grant custom Artifact Registry role (replaces roles/artifactregistry.writer)
const artifactBinding = new gcp.projects.IAMMember("deploy-artifact-custom", {
    project: projectId,
    role: customRoles.artifactRegistry.name,
    member: `serviceAccount:${deployServiceAccountEmail}`,
}, { dependsOn: [customRoles.artifactRegistry] });

// Grant deploy SA permission to act as service accounts (for Cloud Run runtime SA assignment)
const saUser = new gcp.projects.IAMMember("deploy-sa-user", {
    project: projectId,
    role: "roles/iam.serviceAccountUser",
    member: `serviceAccount:${deployServiceAccountEmail}`,
});

// Get project number for outputs
const project = gcp.organizations.getProjectOutput({ projectId });

// Outputs
export const registryId = registry.id;
export const registryName = registry.name;
export const registryUrl = pulumi.interpolate`${region}-docker.pkg.dev/${projectId}/${registry.repositoryId}`;
export const wifPoolId = wifPool.id;
export const wifPoolName = wifPool.name;
export const wifProviderId = wifProvider.id;
export const wifProviderName = wifProvider.name;
export const deployServiceAccountEmail_ = deployServiceAccountEmail;
export const projectId_ = projectId;
export const projectNumber = project.number;
export const region_ = region;

// Custom role names for reference
export const customRoleCloudRun = customRoles.cloudRunDeploy.name;
export const customRoleArtifactRegistry = customRoles.artifactRegistry.name;

// Full WIF provider resource name for Bitbucket authentication
export const wifProviderResourceName = pulumi.interpolate`projects/${project.number}/locations/global/workloadIdentityPools/${wifPool.workloadIdentityPoolId}/providers/${wifProvider.workloadIdentityPoolProviderId}`;

// Instructions for client apps
export const bitbucketPipelineConfig = pulumi.interpolate`
Infrastructure setup complete!

Registry URL: ${region}-docker.pkg.dev/${projectId}/${registry.repositoryId}
WIF Provider: ${wifProviderResourceName}

Required Bitbucket Repository Variables:
  GCP_PROJECT: ${projectId}
  GCP_PROJECT_NUMBER: ${project.number}
  GCP_REGION: ${region}
  STATE_BUCKET: (from bootstrap output)
  WIF_PROVIDER: ${wifProviderResourceName}
  SERVICE_ACCOUNT_EMAIL: ${deployServiceAccountEmail}
  PULUMI_ORG: (your Pulumi organization/username)
  PULUMI_CONFIG_PASSPHRASE: (secured - your encryption passphrase)
`;
