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

    // For ACR, use built-in AcrPush role (includes pull + push)
    // Custom roles don't work well with ACR data actions
    // Built-in role ID for AcrPush: 8311e382-0749-4cb8-b61a-304f252e45ec
    const acrPushRoleId = pulumi.interpolate`/subscriptions/${subscriptionId}/providers/Microsoft.Authorization/roleDefinitions/8311e382-0749-4cb8-b61a-304f252e45ec`;

    return { containerAppsDeploy, acrPushRoleId };
}
