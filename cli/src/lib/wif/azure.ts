// cli/src/lib/wif/azure.ts
/**
 * Azure Workload Identity Federation token exchange.
 *
 * Unlike GCP which requires a two-step STS exchange, Azure's @azure/identity SDK
 * handles OIDC token exchange automatically when running in CI environments.
 *
 * For GitHub Actions: Uses ACTIONS_ID_TOKEN_REQUEST_TOKEN
 * For Bitbucket Pipelines: Uses BITBUCKET_STEP_OIDC_TOKEN
 *
 * This module provides a wrapper for consistency with the GCP implementation.
 */

export class AzureWifError extends Error {
  constructor(
    message: string,
    public readonly step: "token_request" | "validation",
    public readonly details?: string
  ) {
    super(message);
    this.name = "AzureWifError";
  }
}

export interface AzureWifConfig {
  clientId: string;
  tenantId: string;
  subscriptionId: string;
}

/**
 * Validates that the required Azure environment variables are set.
 * In CI environments with OIDC enabled, the @azure/identity DefaultAzureCredential
 * will automatically handle token exchange.
 */
export function validateAzureEnvironment(): AzureWifConfig {
  const clientId = process.env.AZURE_CLIENT_ID;
  const tenantId = process.env.AZURE_TENANT_ID;
  const subscriptionId = process.env.AZURE_SUBSCRIPTION_ID;

  if (!clientId || !tenantId || !subscriptionId) {
    const missing = [];
    if (!clientId) missing.push("AZURE_CLIENT_ID");
    if (!tenantId) missing.push("AZURE_TENANT_ID");
    if (!subscriptionId) missing.push("AZURE_SUBSCRIPTION_ID");

    throw new AzureWifError(
      `Missing required Azure environment variables: ${missing.join(", ")}`,
      "validation",
      "Ensure Azure OIDC is configured in your CI/CD workflow"
    );
  }

  // Check for OIDC token (GitHub or Bitbucket)
  const hasGitHubOIDC = !!process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  const hasBitbucketOIDC = !!process.env.BITBUCKET_STEP_OIDC_TOKEN;

  if (!hasGitHubOIDC && !hasBitbucketOIDC) {
    throw new AzureWifError(
      "No OIDC token available. Ensure OIDC is enabled in your CI/CD pipeline.",
      "token_request",
      "For GitHub Actions: Add 'permissions: id-token: write'. For Bitbucket: Add 'oidc: true' to the step."
    );
  }

  return { clientId, tenantId, subscriptionId };
}

/**
 * Azure uses the azure/login action or az login with federated credentials,
 * which sets up the environment for subsequent Azure CLI/SDK calls.
 *
 * This function validates the environment and returns the config needed
 * for Azure operations. The actual token exchange is handled by Azure SDK.
 */
export async function setupAzureAuth(): Promise<AzureWifConfig> {
  const config = validateAzureEnvironment();
  console.log(`Azure OIDC configured for tenant ${config.tenantId}`);
  return config;
}
