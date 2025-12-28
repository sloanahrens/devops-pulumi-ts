import * as gcp from "@pulumi/gcp";

/**
 * Creates custom IAM roles with minimal permissions for Pulumi deployments.
 * These replace broad predefined roles like roles/run.admin.
 */
export function createCustomRoles(projectId: string) {

    // Cloud Run deployment - create, update, delete services + set IAM
    const cloudRunDeploy = new gcp.projects.IAMCustomRole("pulumi-cloudrun-deploy", {
        roleId: "pulumiCloudRunDeploy",
        title: "Pulumi Cloud Run Deploy",
        description: "Minimal permissions for Cloud Run service deployment via Pulumi",
        permissions: [
            // Service lifecycle
            "run.services.create",
            "run.services.delete",
            "run.services.get",
            "run.services.list",
            "run.services.update",
            // IAM for public access
            "run.services.getIamPolicy",
            "run.services.setIamPolicy",
            // Revisions
            "run.revisions.delete",
            "run.revisions.get",
            "run.revisions.list",
            // Configurations and routes (read-only, needed for status checks)
            "run.configurations.get",
            "run.configurations.list",
            "run.routes.get",
            "run.routes.list",
        ],
    });

    // Artifact Registry - push images, manage tags, cleanup old versions
    const artifactRegistry = new gcp.projects.IAMCustomRole("pulumi-artifact-registry", {
        roleId: "pulumiArtifactRegistry",
        title: "Pulumi Artifact Registry",
        description: "Minimal permissions for Docker image push and cleanup",
        permissions: [
            // Repository access (read-only)
            "artifactregistry.repositories.get",
            // Image upload
            "artifactregistry.repositories.uploadArtifacts",
            // Tag management
            "artifactregistry.tags.create",
            "artifactregistry.tags.update",
            "artifactregistry.tags.list",
            // Version management (for cleanup)
            "artifactregistry.versions.delete",
            "artifactregistry.versions.get",
            "artifactregistry.versions.list",
        ],
    });

    return { cloudRunDeploy, artifactRegistry };
}
