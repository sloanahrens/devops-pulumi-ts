import * as pulumi from "@pulumi/pulumi";
import * as azure from "@pulumi/azure-native";

// Azure built-in role definition IDs
// See: https://learn.microsoft.com/en-us/azure/role-based-access-control/built-in-roles
const AZURE_ROLES = {
    AcrPush: "8311e382-0749-4cb8-b61a-304f252e45ec",
    Contributor: "b24988ac-6180-42a0-ab88-20f7382dd24c",
} as const;

// Common tags applied to all resources
const commonTags = {
    managedBy: "pulumi",
};

const config = new pulumi.Config();
const location = config.get("location") || "eastus";
const githubOrg = config.require("githubOrg");
const githubRepo = config.require("githubRepo");

// Shared resource group
const sharedRg = new azure.resources.ResourceGroup("devops-shared-rg", {
    location,
    tags: {
        ...commonTags,
        purpose: "shared-infrastructure",
    },
});

// Container Registry
const acr = new azure.containerregistry.Registry("acr", {
    resourceGroupName: sharedRg.name,
    location: sharedRg.location,
    sku: { name: "Basic" },
    adminUserEnabled: false,
    tags: commonTags,
});

// Container Apps Environment
const environment = new azure.app.ManagedEnvironment("env", {
    resourceGroupName: sharedRg.name,
    location: sharedRg.location,
    tags: commonTags,
});

// Managed Identity for GitHub Actions deployments
const deployIdentity = new azure.managedidentity.UserAssignedIdentity("deploy-identity", {
    resourceGroupName: sharedRg.name,
    location: sharedRg.location,
    tags: {
        ...commonTags,
        purpose: "github-actions-deployment",
    },
});

// OIDC Federation - trusts GitHub Actions from your repo
// Wildcards allow any branch to deploy (branch isolation pattern)
const federation = new azure.managedidentity.FederatedIdentityCredential("github-federation", {
    resourceGroupName: sharedRg.name,
    resourceName: deployIdentity.name,
    issuer: "https://token.actions.githubusercontent.com",
    subject: `repo:${githubOrg}/${githubRepo}:ref:refs/heads/*`,
    audiences: ["api://AzureADTokenExchange"],
});

// Get current subscription for role assignment scope
const clientConfig = azure.authorization.getClientConfigOutput();

// Role assignment: AcrPush on Container Registry
const acrPushRole = new azure.authorization.RoleAssignment("acr-push", {
    principalId: deployIdentity.principalId,
    principalType: "ServicePrincipal",
    roleDefinitionId: pulumi.interpolate`/subscriptions/${clientConfig.subscriptionId}/providers/Microsoft.Authorization/roleDefinitions/${AZURE_ROLES.AcrPush}`,
    scope: acr.id,
});

// Role assignment: Contributor scoped to shared resource group only
// All branch deployments go into this resource group for security
const contributorRole = new azure.authorization.RoleAssignment("contributor", {
    principalId: deployIdentity.principalId,
    principalType: "ServicePrincipal",
    roleDefinitionId: pulumi.interpolate`/subscriptions/${clientConfig.subscriptionId}/providers/Microsoft.Authorization/roleDefinitions/${AZURE_ROLES.Contributor}`,
    scope: sharedRg.id,
});

// Exports for app stacks to reference
export const resourceGroupName = sharedRg.name;
export const environmentId = environment.id;
export const environmentName = environment.name;
export const acrLoginServer = acr.loginServer;
export const acrName = acr.name;
export const deployIdentityId = deployIdentity.id;
export const deployIdentityClientId = deployIdentity.clientId;
export const deployIdentityPrincipalId = deployIdentity.principalId;
