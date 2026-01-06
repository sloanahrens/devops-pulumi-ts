import * as pulumi from "@pulumi/pulumi";
import * as azure from "@pulumi/azure-native";
import { createCustomRoles } from "./roles";

// Common tags applied to all resources
const commonTags = {
    managedBy: "pulumi",
};

const config = new pulumi.Config();

// Resource group name is required - must exist already
// Can be set via Pulumi config or AZURE_RESOURCE_GROUP env var
const resourceGroupName = config.require("resourceGroupName");

// Get the existing resource group
const existingRg = azure.resources.getResourceGroupOutput({
    resourceGroupName: resourceGroupName,
});

// CI/CD provider configuration (at least one required)
const githubOrg = config.get("githubOrg");
const githubRepo = config.get("githubRepo");
const bitbucketWorkspaceUuid = config.get("bitbucketWorkspaceUuid");
const bitbucketWorkspaceSlug = config.get("bitbucketWorkspaceSlug");

// Validate at least one CI provider is configured
if (!githubOrg && !bitbucketWorkspaceUuid) {
    throw new Error("At least one CI provider must be configured: set githubOrg or bitbucketWorkspaceUuid");
}

// Container Registry
const acr = new azure.containerregistry.Registry("acr", {
    resourceGroupName: existingRg.name,
    location: existingRg.location,
    sku: { name: "Basic" },
    adminUserEnabled: false,
    tags: commonTags,
});

// Container Apps Environment
const environment = new azure.app.ManagedEnvironment("env", {
    resourceGroupName: existingRg.name,
    location: existingRg.location,
    tags: commonTags,
});

// Managed Identity for CI/CD deployments
const deployIdentity = new azure.managedidentity.UserAssignedIdentity("deploy-identity", {
    resourceGroupName: existingRg.name,
    location: existingRg.location,
    tags: {
        ...commonTags,
        purpose: "cicd-deployment",
    },
});

// Get current subscription for role assignment scope
const clientConfig = azure.authorization.getClientConfigOutput();

// Create custom RBAC roles with minimal permissions
const customRoles = createCustomRoles(clientConfig.subscriptionId, existingRg.name);

// Role assignment: Container Apps Deployer (custom role)
const containerAppsRole = new azure.authorization.RoleAssignment("container-apps-deploy", {
    principalId: deployIdentity.principalId,
    principalType: "ServicePrincipal",
    roleDefinitionId: customRoles.containerAppsDeploy.id,
    scope: existingRg.id,
});

// Role assignment: ACR Push (built-in role - custom roles don't work with ACR data actions)
const registryRole = new azure.authorization.RoleAssignment("registry-pusher", {
    principalId: deployIdentity.principalId,
    principalType: "ServicePrincipal",
    roleDefinitionId: customRoles.acrPushRoleId,
    scope: acr.id,
});

// GitHub Actions OIDC Federation (conditional)
let githubWifProvider: pulumi.Output<string> | undefined;
if (githubOrg && githubRepo) {
    const githubFederation = new azure.managedidentity.FederatedIdentityCredential("github-federation", {
        resourceGroupName: existingRg.name,
        resourceName: deployIdentity.name,
        issuer: "https://token.actions.githubusercontent.com",
        subject: `repo:${githubOrg}/${githubRepo}:ref:refs/heads/*`,
        audiences: ["api://AzureADTokenExchange"],
    });

    githubWifProvider = pulumi.interpolate`github:${githubOrg}/${githubRepo}`;
}

// Bitbucket Pipelines OIDC Federation (conditional)
let bitbucketWifProvider: pulumi.Output<string> | undefined;
if (bitbucketWorkspaceUuid && bitbucketWorkspaceSlug) {
    const bitbucketFederation = new azure.managedidentity.FederatedIdentityCredential("bitbucket-federation", {
        resourceGroupName: existingRg.name,
        resourceName: deployIdentity.name,
        issuer: `https://api.bitbucket.org/2.0/workspaces/${bitbucketWorkspaceSlug}/pipelines-config/identity/oidc`,
        subject: bitbucketWorkspaceUuid,
        audiences: [`ari:cloud:bitbucket::workspace/${bitbucketWorkspaceUuid}`],
    });

    bitbucketWifProvider = pulumi.interpolate`bitbucket:${bitbucketWorkspaceSlug}`;
}

// Exports for app stacks to reference
export { resourceGroupName };
export const environmentId = environment.id;
export const environmentName = environment.name;
export const acrLoginServer = acr.loginServer;
export const acrName = acr.name;
export const deployIdentityId = deployIdentity.id;
export const deployIdentityClientId = deployIdentity.clientId;
export const deployIdentityPrincipalId = deployIdentity.principalId;

// Export role IDs for reference
export const containerAppsDeployRoleId = customRoles.containerAppsDeploy.id;
export const acrPushRoleId = customRoles.acrPushRoleId;

// Export WIF provider info (for documentation)
export { githubWifProvider, bitbucketWifProvider };
