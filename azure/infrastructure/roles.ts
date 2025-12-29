import * as azure from "@pulumi/azure-native";
import * as pulumi from "@pulumi/pulumi";

/**
 * Creates custom RBAC role definitions with minimal permissions for deployments.
 * These replace broad built-in roles like Contributor.
 */
export function createCustomRoles(
    subscriptionId: pulumi.Input<string>,
    resourceGroupName: pulumi.Input<string>,
) {
    const rgScope = pulumi.interpolate`/subscriptions/${subscriptionId}/resourceGroups/${resourceGroupName}`;

    // Container Apps deployment - create, update, delete apps + manage revisions
    const containerAppsDeploy = new azure.authorization.RoleDefinition("container-apps-deploy", {
        roleName: "Container Apps Deployer",
        description: "Minimal permissions for Container Apps deployment via Pulumi",
        scope: rgScope,
        assignableScopes: [rgScope],
        permissions: [{
            actions: [
                // Container Apps lifecycle
                "Microsoft.App/containerApps/read",
                "Microsoft.App/containerApps/write",
                "Microsoft.App/containerApps/delete",
                // Revisions management
                "Microsoft.App/containerApps/revisions/read",
                "Microsoft.App/containerApps/revisions/restart/action",
                "Microsoft.App/containerApps/revisions/deactivate/action",
                // Read environment (created by infrastructure stack)
                "Microsoft.App/managedEnvironments/read",
                // Auth config for public/private access
                "Microsoft.App/containerApps/authConfigs/read",
                "Microsoft.App/containerApps/authConfigs/write",
                "Microsoft.App/containerApps/authConfigs/delete",
            ],
            notActions: [],
        }],
    });

    // Container Registry - push/pull images, manage manifests for cleanup
    const registryPusher = new azure.authorization.RoleDefinition("registry-pusher", {
        roleName: "Registry Image Pusher",
        description: "Minimal permissions for Docker image push/pull and cleanup",
        scope: rgScope,
        assignableScopes: [rgScope],
        permissions: [{
            actions: [
                // Pull images (needed for layer caching)
                "Microsoft.ContainerRegistry/registries/pull/read",
                // Push images
                "Microsoft.ContainerRegistry/registries/push/write",
                // Read registry metadata
                "Microsoft.ContainerRegistry/registries/read",
                // Delete manifests (for cleanup of old tags)
                "Microsoft.ContainerRegistry/registries/manifests/delete",
            ],
            notActions: [],
        }],
    });

    return { containerAppsDeploy, registryPusher };
}
