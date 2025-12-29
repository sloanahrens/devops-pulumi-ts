import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";
import { createCustomRoles } from "./roles";

const config = new pulumi.Config();
const gcpConfig = new pulumi.Config("gcp");

const projectId = gcpConfig.require("project");
const region = config.get("region") || "us-central1";
const deployServiceAccountEmail = config.require("deployServiceAccountEmail");

// CI/CD provider configuration (at least one required)
const bitbucketWorkspaceUuid = config.get("bitbucketWorkspaceUuid");
const bitbucketWorkspaceSlug = config.get("bitbucketWorkspaceSlug"); // Required if using Bitbucket
const githubOwner = config.get("githubOwner"); // GitHub org or username

// Validate at least one provider is configured
if (!bitbucketWorkspaceUuid && !githubOwner) {
    throw new Error("At least one CI/CD provider must be configured: set bitbucketWorkspaceUuid or githubOwner");
}

// Validate Bitbucket requires both UUID and slug
if (bitbucketWorkspaceUuid && !bitbucketWorkspaceSlug) {
    throw new Error("Bitbucket requires both bitbucketWorkspaceUuid and bitbucketWorkspaceSlug");
}

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

// Workload Identity Pool for CI/CD OIDC authentication
const wifPool = new gcp.iam.WorkloadIdentityPool("cicd-pool", {
    workloadIdentityPoolId: "cicd-deployments",
    displayName: "CI/CD Deployments",
    description: "Workload Identity Pool for CI/CD pipeline OIDC authentication",
}, { dependsOn: [iamCredentialsApi, stsApi] });

// Bitbucket WIF Provider (conditional)
// Note: issuerUri uses workspace SLUG, attributeCondition uses workspace UUID
let bitbucketProvider: gcp.iam.WorkloadIdentityPoolProvider | undefined;
if (bitbucketWorkspaceUuid && bitbucketWorkspaceSlug) {
    // Extract UUID without braces for audience format
    const uuidWithoutBraces = bitbucketWorkspaceUuid.replace(/[{}]/g, '');
    bitbucketProvider = new gcp.iam.WorkloadIdentityPoolProvider("bitbucket-provider", {
        workloadIdentityPoolId: wifPool.workloadIdentityPoolId,
        workloadIdentityPoolProviderId: "bitbucket",
        displayName: "Bitbucket OIDC Provider",
        description: "OIDC provider for Bitbucket Pipelines",
        oidc: {
            issuerUri: `https://api.bitbucket.org/2.0/workspaces/${bitbucketWorkspaceSlug}/pipelines-config/identity/oidc`,
            // Bitbucket sends audience in format: ari:cloud:bitbucket::workspace/<uuid>
            allowedAudiences: [`ari:cloud:bitbucket::workspace/${uuidWithoutBraces}`],
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
}

// GitHub WIF Provider (conditional)
let githubProvider: gcp.iam.WorkloadIdentityPoolProvider | undefined;
if (githubOwner) {
    githubProvider = new gcp.iam.WorkloadIdentityPoolProvider("github-provider", {
        workloadIdentityPoolId: wifPool.workloadIdentityPoolId,
        workloadIdentityPoolProviderId: "github",
        displayName: "GitHub OIDC Provider",
        description: "OIDC provider for GitHub Actions",
        oidc: {
            issuerUri: "https://token.actions.githubusercontent.com",
        },
        attributeMapping: {
            "google.subject": "assertion.sub",
            "attribute.actor": "assertion.actor",
            "attribute.repository": "assertion.repository",
            "attribute.repository_owner": "assertion.repository_owner",
            "attribute.ref": "assertion.ref",
        },
        attributeCondition: `assertion.repository_owner == "${githubOwner}"`,
    });
}

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

// Grant Cloud Run service agent permission to pull images from Artifact Registry
// Cloud Run uses service-{PROJECT_NUMBER}@serverless-robot-prod.iam.gserviceaccount.com
const cloudRunServiceAgentBinding = new gcp.artifactregistry.RepositoryIamMember("cloudrun-registry-reader", {
    project: projectId,
    location: region,
    repository: registry.repositoryId,
    role: "roles/artifactregistry.reader",
    member: pulumi.interpolate`serviceAccount:service-${project.number}@serverless-robot-prod.iam.gserviceaccount.com`,
}, { dependsOn: [registry, runApi] });

// Outputs
export const registryId = registry.id;
export const registryName = registry.name;
export const registryUrl = pulumi.interpolate`${region}-docker.pkg.dev/${projectId}/${registry.repositoryId}`;
export const wifPoolId = wifPool.id;
export const wifPoolName = wifPool.name;
export const deployServiceAccountEmail_ = deployServiceAccountEmail;
export const projectId_ = projectId;
export const projectNumber = project.number;
export const region_ = region;

// Custom role names for reference
export const customRoleCloudRun = customRoles.cloudRunDeploy.name;
export const customRoleArtifactRegistry = customRoles.artifactRegistry.name;

// Bitbucket-specific outputs (conditional)
export const bitbucketProviderId = bitbucketProvider?.id;
export const bitbucketProviderName = bitbucketProvider?.name;
export const bitbucketWifProvider = bitbucketProvider
    ? pulumi.interpolate`projects/${project.number}/locations/global/workloadIdentityPools/${wifPool.workloadIdentityPoolId}/providers/bitbucket`
    : undefined;

// GitHub-specific outputs (conditional)
export const githubProviderId = githubProvider?.id;
export const githubProviderName = githubProvider?.name;
export const githubWifProvider = githubProvider
    ? pulumi.interpolate`projects/${project.number}/locations/global/workloadIdentityPools/${wifPool.workloadIdentityPoolId}/providers/github`
    : undefined;

// Instructions for Bitbucket client apps
export const bitbucketPipelineConfig = bitbucketProvider ? pulumi.interpolate`
Bitbucket Pipeline Configuration
================================
Registry URL: ${region}-docker.pkg.dev/${projectId}/${registry.repositoryId}
WIF Provider: projects/${project.number}/locations/global/workloadIdentityPools/${wifPool.workloadIdentityPoolId}/providers/bitbucket

Required Repository Variables:
  GCP_PROJECT: ${projectId}
  GCP_PROJECT_NUMBER: ${project.number}
  GCP_REGION: ${region}
  STATE_BUCKET: (from bootstrap output)
  SERVICE_ACCOUNT_EMAIL: ${deployServiceAccountEmail}
  PULUMI_ORG: (your Pulumi organization/username)
  PULUMI_CONFIG_PASSPHRASE: (secured - your encryption passphrase)
` : undefined;

// Instructions for GitHub client apps
export const githubActionsConfig = githubProvider ? pulumi.interpolate`
GitHub Actions Configuration
============================
Registry URL: ${region}-docker.pkg.dev/${projectId}/${registry.repositoryId}
WIF Provider: projects/${project.number}/locations/global/workloadIdentityPools/${wifPool.workloadIdentityPoolId}/providers/github
Service Account: ${deployServiceAccountEmail}

Required Repository Secrets:
  GCP_PROJECT: ${projectId}
  GCP_REGION: ${region}
  STATE_BUCKET: (from bootstrap output)
  PULUMI_ORG: (your Pulumi organization/username)
  PULUMI_CONFIG_PASSPHRASE: (your encryption passphrase)

Required Repository Variables:
  WIF_PROVIDER: projects/${project.number}/locations/global/workloadIdentityPools/${wifPool.workloadIdentityPoolId}/providers/github
  SERVICE_ACCOUNT: ${deployServiceAccountEmail}
` : undefined;
