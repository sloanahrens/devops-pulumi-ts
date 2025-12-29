# devops-cloud-deploy

Unified Pulumi-based infrastructure for deploying containerized applications to **GCP Cloud Run** or **Azure Container Apps**.

## Features

- **Multi-Cloud** - Single CLI and codebase for GCP and Azure
- **Keyless Authentication** - Workload Identity Federation (no stored secrets)
- **Minimum Permissions** - Custom IAM/RBAC roles with only required permissions
- **Per-Branch Deployments** - Each git branch gets its own service
- **Automatic Cleanup** - Resources destroyed when branches are deleted
- **CI/CD Agnostic** - Supports both GitHub Actions and Bitbucket Pipelines
- **TypeScript** - Full type safety for infrastructure code

## Quick Start

### 1. Bootstrap (One-time per cloud)

**GCP:**
```bash
cd gcp/bootstrap
npm install
pulumi login --local
pulumi stack init prod
pulumi config set gcp:project YOUR_PROJECT_ID
pulumi up
```

**Azure:**
```bash
cd azure/bootstrap
npm install
pulumi login --local
pulumi stack init prod
pulumi up
```

### 2. Infrastructure (One-time per cloud)

**GCP:**
```bash
cd gcp/infrastructure
npm install
pulumi login gs://YOUR_STATE_BUCKET
pulumi stack init prod
pulumi config set gcp:project YOUR_PROJECT_ID
pulumi config set deployServiceAccountEmail pulumi-deploy@YOUR_PROJECT.iam.gserviceaccount.com
pulumi config set bitbucketWorkspaceUuid "{YOUR-UUID}"  # For Bitbucket
pulumi config set githubOwner "your-org"                 # For GitHub
pulumi up
```

**Azure:**
```bash
cd azure/infrastructure
npm install
pulumi login azblob://state?storage_account=YOUR_STORAGE_ACCOUNT
pulumi stack init prod
pulumi config set githubOrg "your-org"
pulumi config set githubRepo "your-repo"
pulumi config set bitbucketWorkspaceUuid "{YOUR-UUID}"   # Optional
pulumi config set bitbucketWorkspaceSlug "your-workspace" # Optional
pulumi up
```

### 3. Configure App Repository

Copy the appropriate workflow template to your app repo:

| Cloud | CI/CD Provider | Template |
|-------|----------------|----------|
| GCP | GitHub Actions | `workflows/github/gcp-deploy.yml` |
| GCP | Bitbucket | `workflows/bitbucket/gcp-pipelines.yml` |
| Azure | GitHub Actions | `workflows/github/azure-deploy.yml` |
| Azure | Bitbucket | `workflows/bitbucket/azure-pipelines.yml` |

### 4. Deploy

Push to any branch. The pipeline builds, pushes, and deploys automatically.

## CLI

The unified CLI handles deployments for both clouds:

```bash
# Deploy to GCP
npx devops-deploy deploy --cloud gcp --app myapp --branch main

# Deploy to Azure
npx devops-deploy deploy --cloud azure --app myapp --branch main

# Cleanup (branch deleted)
npx devops-deploy cleanup --cloud gcp --app myapp --branch feature-123
npx devops-deploy cleanup --cloud azure --app myapp --branch feature-123
```

### Cloud Detection

The `--cloud` flag can be omitted if the CLI can auto-detect:
1. `DEPLOY_CLOUD` environment variable
2. `GCP_PROJECT` exists → gcp
3. `AZURE_SUBSCRIPTION_ID` exists → azure

### Required Environment Variables

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

## Architecture

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

## Security

**Custom roles** replace broad predefined roles:

**GCP:**
- `pulumiCloudRunDeploy` - Only Cloud Run service management
- `pulumiArtifactRegistry` - Only image push and tag management

**Azure:**
- `Container Apps Deployer` - Only Container Apps management
- `Registry Image Pusher` - Only ACR push/pull

**Deploy identity cannot access:** databases, key vaults, project/subscription-level IAM.

## Multi-Project/Subscription Support

Create different Pulumi stacks for different projects:

```bash
pulumi stack init project-a && pulumi config set gcp:project project-a
pulumi stack init project-b && pulumi config set gcp:project project-b
```

## Branch Name Handling

Branch names are normalized for cloud service name constraints:
- **GCP:** Max 63 characters
- **Azure:** Max 32 characters

Long branch names are truncated with a hash suffix to avoid collisions.

## Configuration Options

| Option | GCP Default | Azure Default | Description |
|--------|-------------|---------------|-------------|
| `--memory` | 512Mi | 2Gi | Memory limit |
| `--cpu` | 1 | 1 | CPU limit |
| `--port` | 8080 | 8080 | Container port |
| `--min-instances` | 0 | 0 | Minimum instances |
| `--max-instances` | 100 | 100 | Maximum instances |
| `--private` | false | false | Require authentication |
| `--custom-domain` | - | - | Custom domain mapping |

## Client Handoff

For consulting engagements, clients can:
1. **Delete unused cloud folder** - Keep only `gcp/` or `azure/`
2. **Keep both** - Flexibility for multi-cloud deployments later

See [CLAUDE.md](CLAUDE.md) for detailed technical documentation.
