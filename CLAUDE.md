# CLAUDE.md - pulumi-gcp-ops

## Overview

Pulumi-based infrastructure for deploying containerized applications to GCP Cloud Run via Bitbucket Pipelines. Uses Workload Identity Federation for keyless authentication and custom IAM roles for minimum-privilege security.

This replaces the Terraform-based `devops-cloud-run` repository with a TypeScript-first approach.

## Architecture

### Three-Tier Stack Structure

```
Bootstrap (local state)        Infrastructure (GCS state)       App (GCS state, per-branch)
├── GCS bucket             →   ├── Artifact Registry        →   ├── Cloud Run service
├── KMS key                    ├── WIF Pool/Provider            ├── IAM bindings
└── Deploy service account     ├── Custom IAM roles             └── StackReference to infra
                               └── Role grants to deploy SA
```

### Stack Responsibilities

**Bootstrap** (`/bootstrap/index.ts`):
- GCS bucket for Pulumi state (versioned, KMS-encrypted)
- KMS key ring and crypto key for state encryption
- Deploy service account (`pulumi-deploy@project.iam.gserviceaccount.com`)
- Grants deploy SA access to state bucket and KMS key

**Infrastructure** (`/infrastructure/index.ts`, `/infrastructure/roles.ts`):
- Artifact Registry for Docker images
- Workload Identity Pool/Provider for Bitbucket OIDC
- Custom IAM roles (`pulumiCloudRunDeploy`, `pulumiArtifactRegistry`)
- Grants custom roles to deploy SA
- Outputs registry URL, WIF provider name, project number

**App** (`/app/index.ts`):
- Cloud Run service per branch
- IAM binding for public access (optional)
- Optional runtime service account for apps with backend resources
- Uses StackReference to get registry URL from infrastructure

## Security Model

### Minimum-Permission Custom Roles

Instead of broad predefined roles, we use custom roles with only required permissions:

**`pulumiCloudRunDeploy`** (replaces `roles/run.admin`):
```
run.services.create, run.services.delete, run.services.get,
run.services.getIamPolicy, run.services.list, run.services.setIamPolicy,
run.services.update, run.revisions.delete, run.revisions.get,
run.revisions.list, run.configurations.get, run.configurations.list,
run.routes.get, run.routes.list
```

**`pulumiArtifactRegistry`** (replaces `roles/artifactregistry.writer`):
```
artifactregistry.repositories.get, artifactregistry.repositories.uploadArtifacts,
artifactregistry.tags.create, artifactregistry.tags.update, artifactregistry.tags.list,
artifactregistry.versions.delete, artifactregistry.versions.get, artifactregistry.versions.list
```

### What Deploy SA Can Do
- Push Docker images to Artifact Registry
- Create/update/delete Cloud Run services
- Set IAM policy on Cloud Run services (for public access)
- Read/write Pulumi state in GCS
- Use KMS key for state encryption
- Assign runtime service accounts to Cloud Run

### What Deploy SA Cannot Do
- Access Firestore, Secret Manager, Identity Platform
- View project-level resources beyond what's needed
- Manage IAM at project level
- Access any resources outside Cloud Run and Artifact Registry

### Runtime Service Account Pattern

For apps with backend resources (Firestore, Secret Manager, etc.):

1. App repo creates its own runtime SA with required permissions
2. App pipeline passes `runtimeServiceAccountEmail` to pulumi-gcp-ops app stack
3. Cloud Run service runs as the runtime SA
4. Deploy SA only assigns the runtime SA (via `roles/iam.serviceAccountUser`)

```bash
# Stateless app (no backend)
pulumi config set appName fractals-nextjs

# App with backend (e.g., Firestore access)
pulumi config set appName git-monitor
pulumi config set runtimeServiceAccountEmail git-monitor-app@project.iam.gserviceaccount.com
```

## Comparison with devops-cloud-run

| Aspect | devops-cloud-run | pulumi-gcp-ops |
|--------|------------------|----------------|
| IaC Tool | Terraform (HCL) | Pulumi (TypeScript) |
| Auth Method | Service Account Key (JSON) | Workload Identity Federation (OIDC) |
| Permissions | Custom roles (6 roles) | Custom roles (2 roles) + minimal predefined |
| State Backend | GCS (Terraform) | GCS (Pulumi) |
| Branch Isolation | Terraform workspaces | Pulumi stacks |
| Type Safety | None | Full TypeScript types |

## Multi-Project Support

### Same Repo, Multiple Projects

Use different Pulumi stacks for different GCP projects:

```bash
# Project A
pulumi stack init project-a
pulumi config set gcp:project project-a-id

# Project B
pulumi stack init project-b
pulumi config set gcp:project project-b-id
```

Each stack has its own config file (`Pulumi.<stack>.yaml`) and state.

### Different GCP Accounts

For different GCP accounts:
1. Run bootstrap separately in each account
2. Each account gets its own state bucket, KMS key, deploy SA
3. Update CI/CD variables to point to the right account's resources

## What's Stored Where

| Location | Contents | Sensitive? | In Git? |
|----------|----------|------------|---------|
| Repo code | `index.ts`, scripts, `Pulumi.yaml` | No | Yes |
| Stack config | `Pulumi.*.yaml` (project ID, SA email) | Mildly | No (gitignored) |
| Bootstrap state | Resource IDs, outputs | Mildly | No (`~/.pulumi/`) |
| GCS state | Full Pulumi state for infra/app | Yes | No (GCS bucket) |
| CI/CD variables | Project ID, SA email, passphrase | Yes | No (Bitbucket) |

**The repo is safe to be public.** All sensitive data is in:
- Pulumi state (GCS bucket)
- Stack config files (gitignored)
- CI/CD variables (Bitbucket)

## State Recovery

### If Stack Config (`Pulumi.*.yaml`) is Lost

Recreate with the same values:
```bash
pulumi config set gcp:project your-project
pulumi config set deployServiceAccountEmail pulumi-deploy@project.iam.gserviceaccount.com
# etc.
```

### If Bootstrap Local State is Lost

Options:
1. **Import resources** into new stack:
   ```bash
   pulumi import gcp:storage/bucket:Bucket pulumi-state project-pulumi-state
   pulumi import gcp:serviceaccount/account:Account deploy-sa projects/project/serviceAccounts/pulumi-deploy@project.iam.gserviceaccount.com
   ```

2. **Delete and recreate** (if resources aren't critical):
   ```bash
   gcloud storage buckets delete gs://project-pulumi-state
   gcloud iam service-accounts delete pulumi-deploy@project.iam.gserviceaccount.com
   pulumi up  # Creates fresh resources
   ```

3. **Use existing resources without import** - infrastructure stack can use the existing bucket even without bootstrap state

### If GCS State is Lost

GCS bucket has versioning enabled:
```bash
# List versions
gsutil ls -la gs://project-pulumi-state/.pulumi/

# Restore previous version
gsutil cp gs://project-pulumi-state/.pulumi/stacks/prod.json#123456 \
          gs://project-pulumi-state/.pulumi/stacks/prod.json
```

### If Resources are Orphaned

Resources exist in GCP regardless of Pulumi state. Reconnect via:
```bash
pulumi import gcp:cloudrun/service:Service app projects/project/locations/region/services/service-name
```

## Commands

```bash
# Bootstrap (one-time, local state)
cd bootstrap
npm install
pulumi login --local
pulumi stack init prod
pulumi config set gcp:project YOUR_PROJECT
pulumi up

# Infrastructure (one-time, GCS state)
cd infrastructure
npm install
pulumi login gs://$(cd ../bootstrap && pulumi stack output stateBucketName)
pulumi stack init prod
pulumi config set gcp:project YOUR_PROJECT
pulumi config set deployServiceAccountEmail $(cd ../bootstrap && pulumi stack output deployServiceAccountEmail)
pulumi config set bitbucketWorkspaceUuid "{YOUR-UUID}"
pulumi up

# App (per-branch, usually via CI/CD)
cd app
npm install
pulumi login gs://$STATE_BUCKET
pulumi stack select org/app/myapp-main --create
pulumi config set gcp:project YOUR_PROJECT
pulumi config set appName myapp
pulumi config set imageTag main
pulumi config set infraStackRef org/infrastructure/prod
pulumi up
```

## Testing

```bash
# Test normalize-branch script
./scripts/normalize-branch.sh "feature/API-123"  # -> feature-api-123

# Type-check all stacks
cd bootstrap && npx tsc --noEmit
cd ../infrastructure && npx tsc --noEmit
cd ../app && npx tsc --noEmit
```

## Key Files

| File | Purpose |
|------|---------|
| `bootstrap/index.ts` | GCS bucket, KMS key, deploy SA |
| `infrastructure/index.ts` | Artifact Registry, WIF, role grants |
| `infrastructure/roles.ts` | Custom IAM role definitions |
| `app/index.ts` | Cloud Run service, optional runtime SA |
| `scripts/normalize-branch.sh` | Branch name → DNS-safe label |
| `scripts/get-wif-token.sh` | Bitbucket OIDC → GCP access token |
| `bitbucket-pipelines.yml` | Example pipeline for client apps |

## App Stack Configuration

| Config | Required | Default | Description |
|--------|----------|---------|-------------|
| `appName` | Yes | - | Application name |
| `imageTag` | Yes | - | Docker image tag (normalized branch) |
| `infraStackRef` | Yes | - | Reference to infrastructure stack |
| `region` | No | us-central1 | GCP region |
| `cpuLimit` | No | 1 | CPU limit |
| `memoryLimit` | No | 512Mi | Memory limit |
| `minInstances` | No | 0 | Minimum instances |
| `maxInstances` | No | 100 | Maximum instances |
| `containerPort` | No | 8080 | Container port |
| `allowUnauthenticated` | No | true | Allow public access |
| `healthCheckPath` | No | /health | Health check endpoint |
| `runtimeServiceAccountEmail` | No | - | Runtime SA for apps with backend |

## CI/CD Variables for Client Apps

| Variable | Description | Secured? |
|----------|-------------|----------|
| `GCP_PROJECT` | GCP project ID | No |
| `GCP_PROJECT_NUMBER` | GCP project number (for WIF) | No |
| `GCP_REGION` | GCP region | No |
| `STATE_BUCKET` | GCS bucket for Pulumi state | No |
| `SERVICE_ACCOUNT_EMAIL` | Deploy SA email | No |
| `PULUMI_ORG` | Pulumi organization/username | No |
| `PULUMI_CONFIG_PASSPHRASE` | State encryption passphrase | Yes |
