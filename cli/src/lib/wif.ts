// cli/src/lib/wif.ts

export interface WifTokenParams {
  oidcToken: string;
  projectNumber: string;
  poolId: string;
  providerId: string;
  serviceAccountEmail: string;
}

export class WifTokenError extends Error {
  constructor(
    public step: "sts" | "iam",
    public statusCode: number,
    public details: string
  ) {
    super(`WIF token exchange failed at ${step} step: ${details}`);
    this.name = "WifTokenError";
  }
}

/**
 * Exchange Bitbucket OIDC token for GCP access token via Workload Identity Federation.
 *
 * This is a two-step process:
 * 1. Exchange OIDC token for STS token via sts.googleapis.com
 * 2. Exchange STS token for service account access token via iamcredentials.googleapis.com
 */
export async function exchangeWifToken(params: WifTokenParams): Promise<string> {
  const { oidcToken, projectNumber, poolId, providerId, serviceAccountEmail } = params;

  // Step 1: Exchange OIDC token for STS token
  const audience = `//iam.googleapis.com/projects/${projectNumber}/locations/global/workloadIdentityPools/${poolId}/providers/${providerId}`;

  const stsResponse = await fetch("https://sts.googleapis.com/v1/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      audience,
      scope: "https://www.googleapis.com/auth/cloud-platform",
      requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
      subject_token: oidcToken,
      subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
    }),
  });

  if (!stsResponse.ok) {
    const details = await stsResponse.text();
    throw new WifTokenError("sts", stsResponse.status, details);
  }

  const stsData = await stsResponse.json() as { access_token: string };
  const stsToken = stsData.access_token;

  if (!stsToken) {
    throw new WifTokenError("sts", 200, "No access_token in response");
  }

  // Step 2: Exchange STS token for service account access token
  const iamResponse = await fetch(
    `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${serviceAccountEmail}:generateAccessToken`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${stsToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        scope: ["https://www.googleapis.com/auth/cloud-platform"],
      }),
    }
  );

  if (!iamResponse.ok) {
    const details = await iamResponse.text();
    throw new WifTokenError("iam", iamResponse.status, details);
  }

  const iamData = await iamResponse.json() as { accessToken: string };
  const accessToken = iamData.accessToken;

  if (!accessToken) {
    throw new WifTokenError("iam", 200, "No accessToken in response");
  }

  return accessToken;
}
