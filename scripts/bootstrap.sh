#!/bin/bash
# One-time bootstrap for a GCP project
# Creates the GCS bucket and KMS key for Pulumi state storage
#
# Prerequisites:
# - gcloud CLI installed and authenticated (gcloud auth login)
# - Node.js 20+ installed
# - Pulumi CLI installed

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/../bootstrap"

echo "=== Pulumi GCP Bootstrap ==="
echo ""

# Check for gcloud auth
if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" 2>/dev/null | head -1 | grep -q .; then
    echo "Error: No active gcloud authentication found."
    echo "Run: gcloud auth login"
    exit 1
fi

# Get current project
PROJECT_ID=$(gcloud config get-value project 2>/dev/null)
if [ -z "$PROJECT_ID" ]; then
    echo "Error: No GCP project configured."
    echo "Run: gcloud config set project YOUR_PROJECT_ID"
    exit 1
fi

echo "Using GCP project: ${PROJECT_ID}"
echo ""

# Check for Node.js
if ! command -v node &> /dev/null; then
    echo "Error: Node.js is not installed."
    echo "Install Node.js 20+ to continue."
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
    echo "Error: Node.js 20+ is required (found v${NODE_VERSION})."
    exit 1
fi

# Check for Pulumi
if ! command -v pulumi &> /dev/null; then
    echo "Error: Pulumi CLI is not installed."
    echo "Install from: https://www.pulumi.com/docs/install/"
    exit 1
fi

# Install dependencies
echo "Installing dependencies..."
npm ci

# Login to local state (bootstrap uses file-based state)
echo ""
echo "Configuring local Pulumi state..."
pulumi login --local

# Select or create stack
echo ""
echo "Selecting stack 'prod'..."
pulumi stack select prod --create 2>/dev/null || true

# Set configuration
echo ""
echo "Setting configuration..."
pulumi config set gcp:project "$PROJECT_ID"

# Optional: set region
read -p "GCP region (default: us-central1): " REGION
REGION=${REGION:-us-central1}
pulumi config set region "$REGION"

# Run Pulumi up
echo ""
echo "Running pulumi up..."
pulumi up

echo ""
echo "=== Bootstrap Complete ==="
echo ""
STATE_BUCKET=$(pulumi stack output stateBucketName 2>/dev/null)
DEPLOY_SA=$(pulumi stack output deployServiceAccountEmail 2>/dev/null)

echo "State bucket: gs://${STATE_BUCKET}"
echo "Deploy SA: ${DEPLOY_SA}"
echo ""
echo "Next steps:"
echo "1. cd ../infrastructure"
echo "2. npm ci"
echo "3. pulumi login gs://${STATE_BUCKET}"
echo "4. pulumi stack select prod --create"
echo "5. pulumi config set gcp:project ${PROJECT_ID}"
echo "6. pulumi config set deployServiceAccountEmail ${DEPLOY_SA}"
echo "7. pulumi config set bitbucketWorkspaceUuid YOUR_WORKSPACE_UUID"
echo "8. pulumi up"
