# CLAUDE.md - devops-cloud-deploy

## Overview

Unified Pulumi-based infrastructure for deploying containerized applications to **GCP Cloud Run** or **Azure Container Apps**. Uses Workload Identity Federation for keyless authentication and custom IAM/RBAC roles for minimum-privilege security.

Supports both Bitbucket Pipelines and GitHub Actions.

## Architecture

### Project Structure

```
gcp/                              azure/
├── bootstrap/                    ├── bootstrap/
│   └── GCS bucket, KMS, SA       │   └── Storage account
├── infrastructure/               ├── infrastructure/
│   ├── Artifact Registry         │   ├── ACR
│   ├── WIF Pool (BB + GH)        │   ├── Container Apps Env
│   └── Custom IAM roles          │   ├── WIF (BB + GH)
└── app/                          │   └── Custom RBAC roles
    └── Cloud Run service         └── app/
                                      └── Container App

cli/                              workflows/
├── src/commands/                 ├── github/
│   ├── deploy.ts                 │   ├── gcp-deploy.yml
│   └── cleanup.ts                │   ├── gcp-cleanup.yml
└── src/lib/                      │   ├── azure-deploy.yml
    ├── wif/gcp.ts                │   └── azure-cleanup.yml
    ├── wif/azure.ts              └── bitbucket/
    ├── validation.ts                 ├── gcp-pipelines.yml
    └── ...                           └── azure-pipelines.yml
```

### Three-Tier Stack Structure

Both clouds use the same three-tier pattern:

```
Bootstrap (local state)     →   Infrastructure (cloud state)   →   App (cloud state, per-branch)
├── State storage               ├── Container registry             ├── Container service
├── Encryption keys             ├── WIF Pool/Provider              ├── IAM/RBAC bindings
└── Deploy identity             ├── Custom roles                   └── StackReference to infra
                                └── Role grants
```

**GCP specifics:**
- Bootstrap: GCS bucket, KMS key ring, deploy service account
- Infrastructure: Artifact Registry, WIF Pool
- App: Cloud Run service
- State backend: `gs://bucket-name`

**Azure specifics:**
- Bootstrap: Storage account with blob container
- Infrastructure: ACR, Container Apps Environment, Managed Identity
- App: Container App
- State backend: `azblob://state?storage_account=NAME`

## Security Model

### Custom Roles (Minimum Permissions)

**GCP Custom IAM Roles:**

`pulumiCloudRunDeploy` (replaces `roles/run.admin`):
```
run.services.create, run.services.delete, run.services.get,
run.services.getIamPolicy, run.services.list, run.services.setIamPolicy,
run.services.update, run.revisions.delete, run.revisions.get,
run.revisions.list, run.configurations.get, run.configurations.list,
run.routes.get, run.routes.list
```

`pulumiArtifactRegistry` (replaces `roles/artifactregistry.writer`):
```
artifactregistry.repositories.get, artifactregistry.repositories.uploadArtifacts,
artifactregistry.tags.create, artifactregistry.tags.update, artifactregistry.tags.list,
artifactregistry.versions.delete, artifactregistry.versions.get, artifactregistry.versions.list
```

**Azure Custom RBAC Roles:**

`Container Apps Deployer`:
```
Microsoft.App/containerApps/read, write, delete
Microsoft.App/containerApps/revisions/read, activate, deactivate, restart
Microsoft.App/managedEnvironments/read
Microsoft.App/operations/read
```

`Registry Image Pusher`:
```
Microsoft.ContainerRegistry/registries/read
Microsoft.ContainerRegistry/registries/pull/read
Microsoft.ContainerRegistry/registries/push/write
Microsoft.ContainerRegistry/registries/metadata/read, write
```

### What Deploy Identity Can Do
- Push Docker images to registry
- Create/update/delete container services
- Set IAM/RBAC for public access
- Read/write Pulumi state
- Assign runtime service accounts/identities

### What Deploy Identity Cannot Do
- Access databases, key vaults, secrets
- View project/subscription-level resources
- Manage IAM/RBAC at project/subscription level
- Access resources outside container services and registry

## CLI Usage

```bash
# Deploy
npx devops-deploy deploy --cloud gcp --app myapp --branch main
npx devops-deploy deploy --cloud azure --app myapp --branch main

# Cleanup
npx devops-deploy cleanup --cloud gcp --app myapp --branch feature-123
npx devops-deploy cleanup --cloud azure --app myapp --branch feature-123
```

### Cloud Detection

The `--cloud` flag can be omitted if auto-detectable:
1. `DEPLOY_CLOUD` environment variable
2. `GCP_PROJECT` exists → gcp
3. `AZURE_SUBSCRIPTION_ID` exists → azure

### Common CLI Flags

| Flag | Example | Description |
|------|---------|-------------|
| `--cloud` | `--cloud azure` | Target cloud (gcp, azure) |
| `--app` | `--app myapp` | Application name |
| `--branch` | `--branch main` | Git branch name |
| `--port` | `--port 3000` | Container port (default: 8080) |
| `--memory` | `--memory 1Gi` | Memory limit |
| `--custom-domain` | `--custom-domain example.com` | Custom domain |
| `--build-args-from-env` | `--build-args-from-env "API_KEY"` | Docker build args |

### Branch Name Normalization

Branch names are normalized for cloud service name constraints:
- **GCP:** Max 63 characters
- **Azure:** Max 32 characters

Long branch names are truncated with a hash suffix to avoid collisions.

## Required Environment Variables

**GCP:**
| Variable | Description |
|----------|-------------|
| `GCP_PROJECT` | GCP project ID |
| `GCP_PROJECT_NUMBER` | GCP project number (for WIF) |
| `GCP_REGION` | GCP region |
| `STATE_BUCKET` | GCS bucket for Pulumi state |
| `SERVICE_ACCOUNT_EMAIL` | Deploy service account email |
| `PULUMI_CONFIG_PASSPHRASE` | State encryption passphrase |

**Azure:**
| Variable | Description |
|----------|-------------|
| `AZURE_CLIENT_ID` | Managed identity client ID |
| `AZURE_TENANT_ID` | Azure AD tenant ID |
| `AZURE_SUBSCRIPTION_ID` | Azure subscription ID |
| `AZURE_RESOURCE_GROUP` | Resource group name |
| `STATE_STORAGE_ACCOUNT` | Storage account for Pulumi state |
| `PULUMI_CONFIG_PASSPHRASE` | State encryption passphrase |

## Multi-Project/Subscription Support

Use different Pulumi stacks for different projects:

```bash
# GCP
pulumi stack init project-a && pulumi config set gcp:project project-a

# Azure
pulumi stack init sub-a && pulumi config set azure:subscriptionId sub-a-id
```

## Setup Commands

### GCP Bootstrap (one-time)

```bash
cd gcp/bootstrap
npm install
pulumi login --local
pulumi stack init prod
pulumi config set gcp:project YOUR_PROJECT
pulumi up
```

### GCP Infrastructure (one-time)

```bash
cd gcp/infrastructure
npm install
pulumi login gs://$(cd ../bootstrap && pulumi stack output stateBucketName)
pulumi stack init prod
pulumi config set gcp:project YOUR_PROJECT
pulumi config set deployServiceAccountEmail $(cd ../bootstrap && pulumi stack output deployServiceAccountEmail)
pulumi config set bitbucketWorkspaceUuid "{YOUR-UUID}"  # Optional
pulumi config set githubOwner "your-org"                 # Optional
pulumi up
```

### Azure Bootstrap (one-time)

```bash
cd azure/bootstrap
npm install
pulumi login --local
pulumi stack init prod
pulumi up
```

### Azure Infrastructure (one-time)

```bash
cd azure/infrastructure
npm install
pulumi login azblob://state?storage_account=YOUR_STORAGE_ACCOUNT
pulumi stack init prod
pulumi config set githubOrg "your-org"                     # Optional
pulumi config set githubRepo "your-repo"                   # Optional
pulumi config set bitbucketWorkspaceUuid "{YOUR-UUID}"     # Optional
pulumi config set bitbucketWorkspaceSlug "your-workspace"  # Optional
pulumi up
```

## Testing

```bash
# Run CLI tests
cd cli && npm test

# Type-check GCP stacks
cd gcp/bootstrap && npx tsc --noEmit
cd gcp/infrastructure && npx tsc --noEmit
cd gcp/app && npx tsc --noEmit

# Type-check Azure stacks
cd azure/bootstrap && npx tsc --noEmit
cd azure/infrastructure && npx tsc --noEmit
cd azure/app && npx tsc --noEmit
```

## Key Files

| File | Purpose |
|------|---------|
| `gcp/bootstrap/index.ts` | GCS bucket, KMS key, deploy SA |
| `gcp/infrastructure/index.ts` | Artifact Registry, WIF, role grants |
| `gcp/infrastructure/roles.ts` | Custom GCP IAM role definitions |
| `gcp/app/index.ts` | Cloud Run service |
| `azure/bootstrap/index.ts` | Storage account for state |
| `azure/infrastructure/index.ts` | ACR, Container Apps Env, WIF, role grants |
| `azure/infrastructure/roles.ts` | Custom Azure RBAC role definitions |
| `azure/app/index.ts` | Container App |
| `cli/src/index.ts` | CLI entry point with cloud detection |
| `cli/src/commands/deploy.ts` | Deploy command |
| `cli/src/commands/cleanup.ts` | Cleanup command |
| `cli/src/lib/wif/gcp.ts` | GCP WIF authentication |
| `cli/src/lib/wif/azure.ts` | Azure WIF authentication |
| `workflows/` | CI/CD templates for all cloud+CI combinations |

## App Stack Configuration

| Config | GCP Default | Azure Default | Description |
|--------|-------------|---------------|-------------|
| `appName` | Required | Required | Application name |
| `imageTag` | Required | Required | Docker image tag |
| `infraStackRef` | Required | Required | Reference to infrastructure stack |
| `region` | us-central1 | eastus | Cloud region |
| `cpuLimit` | 1 | 1 | CPU limit |
| `memoryLimit` | 512Mi | 2Gi | Memory limit |
| `minInstances` | 0 | 0 | Minimum instances |
| `maxInstances` | 100 | 100 | Maximum instances |
| `containerPort` | 8080 | 8080 | Container port |
| `allowUnauthenticated` | true | true | Allow public access |
| `runtimeServiceAccountEmail` | - | - | Runtime identity for backend access |
| `customDomain` | - | - | Custom domain mapping |

## CI/CD Workflow Templates

Copy the appropriate template to your app repo:

| Cloud | CI/CD Provider | Template |
|-------|----------------|----------|
| GCP | GitHub Actions | `workflows/github/gcp-deploy.yml` |
| GCP | Bitbucket | `workflows/bitbucket/gcp-pipelines.yml` |
| Azure | GitHub Actions | `workflows/github/azure-deploy.yml` |
| Azure | Bitbucket | `workflows/bitbucket/azure-pipelines.yml` |

## Client Handoff

For consulting engagements, clients can:
1. **Delete unused cloud folder** - Keep only `gcp/` or `azure/`
2. **Keep both** - Flexibility for multi-cloud deployments later

The repo is safe to be public. All sensitive data is stored in:
- Pulumi state (cloud storage)
- Stack config files (gitignored)
- CI/CD variables (pipeline settings)
