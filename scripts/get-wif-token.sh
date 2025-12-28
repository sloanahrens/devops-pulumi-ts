#!/bin/bash
# Exchange Bitbucket OIDC token for GCP access token via Workload Identity Federation
#
# This script is called from Bitbucket Pipelines to authenticate with GCP
# without using stored service account keys.
#
# Required environment variables:
#   BITBUCKET_STEP_OIDC_TOKEN - Provided by Bitbucket when oidc: true is set
#   GCP_PROJECT_NUMBER - GCP project number
#   WIF_POOL_ID - Workload Identity Pool ID (default: bitbucket-deployments)
#   WIF_PROVIDER_ID - Workload Identity Provider ID (default: bitbucket)
#   SERVICE_ACCOUNT_EMAIL - Service account to impersonate

set -e

# Validate required environment variables
if [ -z "$BITBUCKET_STEP_OIDC_TOKEN" ]; then
    echo "Error: BITBUCKET_STEP_OIDC_TOKEN is not set." >&2
    echo "Make sure 'oidc: true' is set in your pipeline step." >&2
    exit 1
fi

if [ -z "$GCP_PROJECT_NUMBER" ]; then
    echo "Error: GCP_PROJECT_NUMBER is not set." >&2
    exit 1
fi

if [ -z "$SERVICE_ACCOUNT_EMAIL" ]; then
    echo "Error: SERVICE_ACCOUNT_EMAIL is not set." >&2
    exit 1
fi

# Defaults
WIF_POOL_ID="${WIF_POOL_ID:-cicd-deployments}"
WIF_PROVIDER_ID="${WIF_PROVIDER_ID:-bitbucket}"

# Construct the audience
AUDIENCE="//iam.googleapis.com/projects/${GCP_PROJECT_NUMBER}/locations/global/workloadIdentityPools/${WIF_POOL_ID}/providers/${WIF_PROVIDER_ID}"

# Step 1: Exchange Bitbucket OIDC token for GCP STS token
STS_RESPONSE=$(curl -s -X POST \
    "https://sts.googleapis.com/v1/token" \
    -H "Content-Type: application/json" \
    -d "{
        \"grant_type\": \"urn:ietf:params:oauth:grant-type:token-exchange\",
        \"audience\": \"${AUDIENCE}\",
        \"scope\": \"https://www.googleapis.com/auth/cloud-platform\",
        \"requested_token_type\": \"urn:ietf:params:oauth:token-type:access_token\",
        \"subject_token\": \"${BITBUCKET_STEP_OIDC_TOKEN}\",
        \"subject_token_type\": \"urn:ietf:params:oauth:token-type:jwt\"
    }")

STS_TOKEN=$(echo "$STS_RESPONSE" | jq -r '.access_token')

if [ -z "$STS_TOKEN" ] || [ "$STS_TOKEN" == "null" ]; then
    echo "Error: Failed to get STS token." >&2
    echo "Response: $STS_RESPONSE" >&2
    exit 1
fi

# Step 2: Exchange STS token for service account access token
SA_RESPONSE=$(curl -s -X POST \
    "https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${SERVICE_ACCOUNT_EMAIL}:generateAccessToken" \
    -H "Authorization: Bearer ${STS_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{
        \"scope\": [\"https://www.googleapis.com/auth/cloud-platform\"]
    }")

ACCESS_TOKEN=$(echo "$SA_RESPONSE" | jq -r '.accessToken')

if [ -z "$ACCESS_TOKEN" ] || [ "$ACCESS_TOKEN" == "null" ]; then
    echo "Error: Failed to get service account access token." >&2
    echo "Response: $SA_RESPONSE" >&2
    exit 1
fi

# Output the access token
echo "$ACCESS_TOKEN"
