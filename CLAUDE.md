# CLAUDE.md - pulumi-gcp-ops

## Overview

This repository provides Pulumi-based infrastructure for deploying containerized applications to GCP Cloud Run via Bitbucket Pipelines. It uses Workload Identity Federation for secure, keyless authentication.

## Architecture

Three-tier Pulumi stack structure:

1. **Bootstrap** (`/bootstrap`) - One-time setup, local state
   - GCS bucket for Pulumi state
   - KMS key for state encryption
   - Deploy service account

2. **Infrastructure** (`/infrastructure`) - Shared resources, GCS state
   - Artifact Registry for Docker images
   - Workload Identity Pool/Provider for Bitbucket OIDC
   - IAM bindings for deploy service account

3. **App** (`/app`) - Per-branch deployments, GCS state
   - Cloud Run service
   - IAM bindings for public access
   - Uses StackReference to infrastructure

## Key Files

- `bootstrap/index.ts` - Bootstrap stack (GCS, KMS, service account)
- `infrastructure/index.ts` - Shared infra (Registry, WIF, IAM)
- `app/index.ts` - Per-branch Cloud Run deployments
- `scripts/normalize-branch.sh` - Branch name normalization
- `scripts/bootstrap.sh` - Bootstrap wrapper
- `scripts/get-wif-token.sh` - WIF token exchange
- `bitbucket-pipelines.yml` - Example pipeline for client apps

## Commands

```bash
# Bootstrap (one-time, local)
cd bootstrap && ./scripts/bootstrap.sh

# Infrastructure (one-time)
cd infrastructure
pulumi login gs://<state-bucket>
pulumi up

# App deployment (per-branch)
cd app
pulumi stack select org/app/myapp-main --create
pulumi config set appName myapp
pulumi config set imageTag main
pulumi config set infraStackRef org/infrastructure/prod
pulumi up
```

## Development Rules

1. Never run Pulumi commands outside of wrapper scripts in CI/CD
2. Bootstrap uses local state; infrastructure and app use GCS state
3. Always normalize branch names before creating stacks
4. App stacks must reference infrastructure stack via StackReference
5. Service names are limited to 63 characters

## Testing

```bash
# Test normalize-branch script
./scripts/normalize-branch.sh "feature/API-123"  # -> feature-api-123

# Test each stack (requires dependencies installed)
cd bootstrap && npm test
cd infrastructure && npm test
cd app && npm test
```

## Related Repositories

- `devops-cloud-run` - Original Terraform-based GCP deployment (being replaced)
- `azure-container-deployment` - Similar pattern for Azure Container Apps
- `next-fractals` - Example app using both patterns
