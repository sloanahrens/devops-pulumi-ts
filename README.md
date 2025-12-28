# pulumi-gcp-ops

Pulumi-based infrastructure for deploying containerized applications to GCP Cloud Run via Bitbucket Pipelines.

## Features

- **Pulumi (TypeScript)** - Modern infrastructure as code
- **GCP Cloud Run** - Serverless container hosting with scale-to-zero
- **Bitbucket Pipelines** - CI/CD integration
- **Workload Identity Federation** - Keyless authentication (no stored secrets)
- **Per-branch deployments** - Each git branch gets its own Cloud Run service
- **Automatic cleanup** - Resources destroyed when branches are deleted

## Prerequisites

- Node.js 20+
- Pulumi CLI
- gcloud CLI (authenticated)
- A GCP project with billing enabled

## Quick Start

### 1. Bootstrap (One-time per GCP project)

```bash
cd bootstrap
../scripts/bootstrap.sh
```

This creates:
- GCS bucket for Pulumi state
- KMS key for state encryption
- Deploy service account

### 2. Infrastructure (One-time per GCP project)

```bash
cd infrastructure
npm ci
pulumi login gs://<state-bucket-from-bootstrap>
pulumi stack select prod --create
pulumi config set gcp:project YOUR_PROJECT_ID
pulumi config set deployServiceAccountEmail <sa-email-from-bootstrap>
pulumi config set bitbucketWorkspaceUuid YOUR_BITBUCKET_WORKSPACE_UUID
pulumi up
```

This creates:
- Artifact Registry for Docker images
- Workload Identity Pool/Provider for Bitbucket OIDC
- IAM bindings

### 3. Client App Setup

1. Copy `bitbucket-pipelines.yml` to your app repository
2. Configure repository variables in Bitbucket:

| Variable | Description |
|----------|-------------|
| `GCP_PROJECT` | GCP project ID |
| `GCP_PROJECT_NUMBER` | GCP project number |
| `GCP_REGION` | GCP region (e.g., us-central1) |
| `STATE_BUCKET` | GCS bucket name for Pulumi state |
| `SERVICE_ACCOUNT_EMAIL` | Deploy service account email |
| `APP_NAME` | Application name prefix |
| `PULUMI_ORG` | Pulumi organization/username |
| `PULUMI_CONFIG_PASSPHRASE` | State encryption passphrase (secured) |

3. Enable OIDC in your pipeline steps:
```yaml
- step:
    oidc: true
    # ...
```

### 4. Deploy

Push to any branch - the pipeline will:
1. Build your Docker image
2. Push to Artifact Registry
3. Deploy to Cloud Run
4. Run health checks

## Directory Structure

```
pulumi-gcp-ops/
├── bootstrap/           # One-time setup (local state)
├── infrastructure/      # Shared resources (GCS state)
├── app/                 # Per-branch deployments (GCS state)
├── scripts/             # Helper scripts
├── bitbucket-pipelines.yml  # Example pipeline
└── README.md
```

## Configuration Options

The app stack supports these configuration options:

| Config | Default | Description |
|--------|---------|-------------|
| `appName` | (required) | Application name |
| `imageTag` | (required) | Docker image tag (normalized branch name) |
| `infraStackRef` | (required) | Reference to infrastructure stack |
| `region` | us-central1 | GCP region |
| `cpuLimit` | 1 | CPU limit |
| `memoryLimit` | 512Mi | Memory limit |
| `minInstances` | 0 | Minimum instances (0 = scale to zero) |
| `maxInstances` | 100 | Maximum instances |
| `containerPort` | 8080 | Container port |
| `allowUnauthenticated` | true | Allow public access |
| `healthCheckPath` | /health | Health check endpoint |

## Branch Cleanup

When a branch is deleted, trigger the cleanup pipeline:

```bash
# Manual cleanup
curl -X POST \
  -H "Authorization: Bearer ${BITBUCKET_TOKEN}" \
  "https://api.bitbucket.org/2.0/repositories/${WORKSPACE}/${REPO}/pipelines/" \
  -H "Content-Type: application/json" \
  -d '{
    "target": {
      "type": "pipeline_ref_target",
      "ref_name": "main",
      "ref_type": "branch",
      "selector": {
        "type": "custom",
        "pattern": "cleanup-branch"
      }
    },
    "variables": [
      {"key": "DELETED_BRANCH", "value": "feature/old-branch"}
    ]
  }'
```

Or configure a webhook to trigger automatically on branch deletion.

## Security

- **No stored secrets** - Uses Workload Identity Federation for authentication
- **Scoped permissions** - Deploy SA only has necessary roles
- **State encryption** - Pulumi state encrypted with KMS key
- **HTTPS only** - Cloud Run services enforce HTTPS

## Related Projects

- [azure-container-deployment](../azure-container-deployment) - Similar pattern for Azure
- [devops-cloud-run](../devops-cloud-run) - Original Terraform-based approach

## License

MIT
