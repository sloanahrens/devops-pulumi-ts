# pulumi-gcp-ops

Pulumi-based infrastructure for deploying containerized applications to GCP Cloud Run via Bitbucket Pipelines.

## Features

- **Keyless Authentication** - Workload Identity Federation (no stored secrets)
- **Minimum Permissions** - Custom IAM roles with only required permissions
- **Per-Branch Deployments** - Each git branch gets its own Cloud Run service
- **Automatic Cleanup** - Resources destroyed when branches are deleted
- **Runtime SA Support** - Apps can use their own service account for backend access
- **TypeScript** - Full type safety for infrastructure code

## Quick Start

### 1. Bootstrap (One-time)

```bash
cd bootstrap
npm install
pulumi login --local
pulumi stack init prod
pulumi config set gcp:project YOUR_PROJECT_ID
pulumi up
```

Creates: GCS state bucket, KMS key, deploy service account

### 2. Infrastructure (One-time)

```bash
cd infrastructure
npm install
pulumi login gs://YOUR_STATE_BUCKET
pulumi stack init prod
pulumi config set gcp:project YOUR_PROJECT_ID
pulumi config set deployServiceAccountEmail pulumi-deploy@YOUR_PROJECT.iam.gserviceaccount.com
pulumi config set bitbucketWorkspaceUuid "{YOUR-WORKSPACE-UUID}"
pulumi up
```

Creates: Artifact Registry, WIF pool/provider, custom IAM roles

### 3. Configure App Repository

Copy `bitbucket-pipelines.yml` to your app repo and set these Bitbucket variables:

| Variable | Description |
|----------|-------------|
| `GCP_PROJECT` | GCP project ID |
| `GCP_PROJECT_NUMBER` | GCP project number |
| `GCP_REGION` | Region (e.g., us-central1) |
| `STATE_BUCKET` | Pulumi state bucket name |
| `SERVICE_ACCOUNT_EMAIL` | Deploy SA email |
| `PULUMI_ORG` | Pulumi org/username |
| `PULUMI_CONFIG_PASSPHRASE` | State encryption passphrase (secured) |

### 4. Deploy

Push to any branch. The pipeline will build, push, and deploy automatically.

## Architecture

```
Bootstrap (local)              Infrastructure (GCS)           App (GCS, per-branch)
├── GCS bucket            →    ├── Artifact Registry     →    ├── Cloud Run service
├── KMS key                    ├── WIF Pool/Provider          ├── IAM bindings
└── Deploy SA                  └── Custom IAM roles           └── StackReference
```

## Security

**Custom IAM roles** replace broad predefined roles:
- `pulumiCloudRunDeploy` - Only Cloud Run service management
- `pulumiArtifactRegistry` - Only image push and tag management

**Deploy SA cannot access:**
- Firestore, Secret Manager, Identity Platform
- Project-level IAM
- Any resources outside Cloud Run/Artifact Registry

**For apps with backends:** Pass `runtimeServiceAccountEmail` config to use a dedicated runtime SA with appropriate permissions.

## Multi-Project Support

Same repo works for multiple GCP projects - just create different Pulumi stacks:

```bash
pulumi stack init project-a && pulumi config set gcp:project project-a
pulumi stack init project-b && pulumi config set gcp:project project-b
```

## State & Recovery

| Location | What's Stored | Recovery |
|----------|---------------|----------|
| Stack config (`Pulumi.*.yaml`) | Project ID, SA email | Recreate with `pulumi config set` |
| Bootstrap state (`~/.pulumi/`) | Resource IDs | `pulumi import` or delete/recreate |
| GCS state | Infra/app state | Restore from bucket versioning |

**The repo is safe to be public** - no secrets are stored in git.

## App Configuration Options

| Config | Default | Description |
|--------|---------|-------------|
| `appName` | (required) | Application name |
| `imageTag` | (required) | Docker image tag |
| `infraStackRef` | (required) | Infrastructure stack reference |
| `region` | us-central1 | GCP region |
| `cpuLimit` | 1 | CPU limit |
| `memoryLimit` | 512Mi | Memory limit |
| `minInstances` | 0 | Min instances (0 = scale to zero) |
| `maxInstances` | 100 | Max instances |
| `healthCheckPath` | /health | Health check endpoint |
| `runtimeServiceAccountEmail` | - | Runtime SA for apps with backend |

## Related

- [devops-cloud-run](https://bitbucket.org/sloanahrens/devops-cloud-run) - Terraform version (being replaced)
- [azure-container-deployment](https://bitbucket.org/sloanahrens/azure-container-deployment) - Azure equivalent

See [CLAUDE.md](CLAUDE.md) for detailed technical documentation.
