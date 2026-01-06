import * as pulumi from "@pulumi/pulumi";
import * as azure from "@pulumi/azure-native";

// Common tags applied to all resources
const commonTags = {
    managedBy: "pulumi",
    purpose: "state-storage",
};

const config = new pulumi.Config();

// Resource group name is required - must exist already
// Can be set via Pulumi config or AZURE_RESOURCE_GROUP env var
const resourceGroupName = config.require("resourceGroupName");

// Get the existing resource group
const existingRg = azure.resources.getResourceGroupOutput({
    resourceGroupName: resourceGroupName,
});

// Get subscription ID for deterministic storage account naming
const clientConfig = azure.authorization.getClientConfigOutput();

// Derive storage account name from subscription ID (last 8 chars)
// Storage account names: 3-24 chars, lowercase alphanumeric only
const derivedStorageAccountName = clientConfig.subscriptionId.apply(
    (subId) => `pulumistate${subId.replace(/-/g, "").slice(-8)}`
);

// Storage account for Pulumi state
const storageAccount = new azure.storage.StorageAccount("state-storage", {
    resourceGroupName: existingRg.name,
    location: existingRg.location,
    accountName: derivedStorageAccountName,
    sku: { name: azure.storage.SkuName.Standard_LRS },
    kind: azure.storage.Kind.StorageV2,
    enableHttpsTrafficOnly: true,
    minimumTlsVersion: azure.storage.MinimumTlsVersion.TLS1_2,
    allowBlobPublicAccess: false,
    tags: commonTags,
});

// Blob container for state files
const stateContainer = new azure.storage.BlobContainer("state", {
    resourceGroupName: existingRg.name,
    accountName: storageAccount.name,
    containerName: "state",
    publicAccess: azure.storage.PublicAccess.None,
});

// Exports
export { resourceGroupName };
export const storageAccountName = storageAccount.name;
export const containerName = stateContainer.name;
export const backendUrl = pulumi.interpolate`azblob://${stateContainer.name}?storage_account=${storageAccount.name}`;
