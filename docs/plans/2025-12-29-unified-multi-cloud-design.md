# Unified Multi-Cloud Deployment Framework

**Date:** 2025-12-29
**Status:** Proposed
**Scope:** Merge `devops-pulumi-ts` and `azure-container-deployment` into a single multi-cloud framework

## Context

Two separate repositories exist for deploying containerized applications:

- **devops-pulumi-ts** (mature): TypeScript CLI, custom IAM roles with minimal permissions, WIF for both Bitbucket and GitHub, per-branch isolation, 10-step deployment pipeline
- **azure-container-deployment** (earlier iteration): Same three-tier stack pattern, GitHub OIDC working, 83 tests, but deploy logic lives in workflow YAML, uses broad Azure roles, no Bitbucket support

The goal is a single framework that works for consulting engagements across GCP and Azure, with both Bitbucket and GitHub CI/CD support. Clients clone and customize the repo—they own it after handoff.

## Decision

**Approach B: Unified Multi-Cloud Repo**

Consolidate both repositories into a single codebase with cloud selection via CLI flag. This eliminates duplicate maintenance while keeping handoff simple (clients can delete the unused cloud folder).

Rejected alternatives:
- **Separate repos** (Approach A): Requires maintaining parallel features in two codebases; risk of drift
- **Shared CLI package** (Approach C): Adds npm dependency management; conflicts with clone-and-customize model

## Architecture

### Project Structure

```
devops-cloud-deploy/
├── cli/                          # Shared TypeScript CLI
│   ├── src/
│   │   ├── index.ts              # Entry point: devops-deploy
│   │   ├── commands/
│   │   │   ├── deploy.ts         # Cloud-agnostic orchestration
│   │   │   └── cleanup.ts
│   │   └── lib/
│   │       ├── wif/
│   │       │   ├── gcp.ts        # GCP STS token exchange
│   │       │   └── azure.ts      # Azure credential handling
│   │       ├── docker.ts         # Shared docker build/push
│   │       ├── pulumi.ts         # Shared Pulumi orchestration
│   │       ├── health.ts         # Shared health checks
│   │       ├── normalize.ts      # Branch normalization (cloud-specific limits)
│   │       └── validation.ts     # Env var validation (cloud-specific schemas)
│   └── package.json
├── gcp/
│   ├── bootstrap/                # GCS bucket, KMS, deploy SA
│   ├── infrastructure/           # Artifact Registry, WIF pool, custom IAM roles
│   ├── app/                      # Cloud Run service (per-branch)
│   └── roles.ts                  # Custom IAM role definitions
├── azure/
│   ├── bootstrap/                # Storage account for Pulumi state
│   ├── infrastructure/           # ACR, Container Apps Environment, managed identity
│   ├── app/                      # Container App (per-branch)
│   └── roles.ts                  # Custom RBAC role definitions
├── workflows/                    # CI/CD templates for clients
│   ├── github/
│   │   ├── gcp-deploy.yml
│   │   ├── azure-deploy.yml
│   │   └── cleanup.yml
│   └── bitbucket/
│       ├── gcp-pipelines.yml
│       └── azure-pipelines.yml
├── scripts/
│   └── bootstrap.sh              # Interactive setup wizard
├── CLAUDE.md
├── README.md
└── package.json
```

### CLI Design

**Commands:**
```bash
npx devops-deploy deploy --cloud gcp|azure --app <name> --branch <branch>
npx devops-deploy cleanup --cloud gcp|azure --app <name> --branch <branch>
```

**Cloud detection (priority order):**
1. Explicit `--cloud` flag
2. `DEPLOY_CLOUD` environment variable
3. Auto-detect from environment variables (GCP_PROJECT → gcp, AZURE_SUBSCRIPTION_ID → azure)

**Shared vs. cloud-specific logic:**

| Component | Shared | Cloud-Specific |
|-----------|--------|----------------|
| Branch normalization | Yes | Length limits (GCP: 63, Azure: 32) |
| Docker build/push | Yes | Registry URL format |
| Health check with retries | Yes | — |
| Pulumi stack orchestration | Yes | Stack paths |
| WIF token exchange | — | Different APIs and audiences |
| Env validation schema | — | Different required variables |

**Deploy pipeline (10 steps):**
1. Validate environment (cloud-specific schema)
2. Normalize branch name (cloud-specific length limits)
3. Exchange OIDC token for cloud credentials
4. Docker login to registry
5. Pull existing image for cache
6. Build Docker image
7. Push to registry
8. Run Pulumi deployment
9. Get service URL from outputs
10. Health check with retries

### Azure Minimal-Permission Roles

The current Azure setup uses broad built-in roles. New custom RBAC roles match GCP's security posture:

**Container Apps Deployer** (replaces Contributor):
```
Microsoft.App/containerApps/read
Microsoft.App/containerApps/write
Microsoft.App/containerApps/delete
Microsoft.App/containerApps/revisions/read
Microsoft.App/containerApps/revisions/restart/action
Microsoft.App/containerApps/revisions/deactivate/action
Microsoft.App/managedEnvironments/read
Microsoft.App/containerApps/authConfigs/*
```

**Registry Image Pusher** (tighter than AcrPush):
```
Microsoft.ContainerRegistry/registries/pull/read
Microsoft.ContainerRegistry/registries/push/write
Microsoft.ContainerRegistry/registries/manifests/delete
```

**Deploy identity capabilities:**
- Create, update, delete Container Apps
- Push/pull images from ACR
- Delete old image tags

**Cannot do:**
- Create storage accounts, databases, VNets
- Modify Container Apps Environment
- Access Key Vault or other services

### Azure Bitbucket WIF Support

Add Bitbucket federated identity credential alongside GitHub:

```typescript
// GitHub credential (existing)
if (githubOrg) {
  new FederatedIdentityCredential("github-deploy", {
    issuer: "https://token.actions.githubusercontent.com",
    subject: `repo:${githubOrg}/${githubRepo}:ref:refs/heads/*`,
    audiences: ["api://AzureADTokenExchange"],
  });
}

// Bitbucket credential (new)
if (bitbucketWorkspaceUuid) {
  new FederatedIdentityCredential("bitbucket-deploy", {
    issuer: `https://api.bitbucket.org/2.0/workspaces/${bitbucketWorkspaceSlug}/pipelines-config/identity/oidc`,
    subject: bitbucketWorkspaceUuid,
    audiences: [`ari:cloud:bitbucket::workspace/${bitbucketWorkspaceUuid}`],
  });
}
```

### CI/CD Workflow Templates

Clients copy one workflow file matching their cloud + CI provider:

**GitHub Actions (example: azure-deploy.yml):**
```yaml
name: Deploy to Azure
on:
  push:
    branches: ['*']

permissions:
  id-token: write
  contents: read

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: azure/login@v2
        with:
          client-id: ${{ vars.AZURE_CLIENT_ID }}
          tenant-id: ${{ vars.AZURE_TENANT_ID }}
          subscription-id: ${{ vars.AZURE_SUBSCRIPTION_ID }}
      - run: npx devops-deploy deploy --cloud azure --app ${{ vars.APP_NAME }} --branch ${{ github.ref_name }}
```

**Bitbucket Pipelines (example: azure-pipelines.yml):**
```yaml
pipelines:
  default:
    - step:
        name: Deploy to Azure
        oidc: true
        script:
          - npx devops-deploy deploy --cloud azure --app $APP_NAME --branch $BITBUCKET_BRANCH
```

## Migration Plan

### Phase 1: Create unified repo structure
Use `devops-pulumi-ts` as the base (more mature). Restructure folders:
```bash
mkdir gcp azure
mv bootstrap infrastructure app gcp/
mv cli/src/lib/wif.ts cli/src/lib/wif/gcp.ts
```

### Phase 2: Port Azure stacks
Copy stacks from `azure-container-deployment`:
```bash
cp -r ../azure-container-deployment/bootstrap azure/
cp -r ../azure-container-deployment/infrastructure azure/
cp -r ../azure-container-deployment/app azure/
```

### Phase 3: Enhance Azure to match GCP

| Task | Description |
|------|-------------|
| Custom RBAC roles | Create `azure/roles.ts` with minimal-permission definitions |
| Bitbucket WIF | Add federated credential in `azure/infrastructure/` |
| CLI Azure WIF | Create `cli/src/lib/wif/azure.ts` |
| Validation schemas | Create cloud-specific Zod schemas |
| Branch normalization | Handle 32-char limit for Azure |

### Phase 4: Update CLI for cloud selection
- Add `--cloud` flag to deploy/cleanup commands
- Refactor to use cloud-specific modules
- Update Pulumi paths

### Phase 5: Test both paths
```bash
npx devops-deploy deploy --cloud gcp --app test --branch main
npx devops-deploy deploy --cloud azure --app test --branch main
```

### Phase 6: Archive old repo
Keep `azure-container-deployment` read-only for reference.

## Scope Estimate

| Component | Lines |
|-----------|-------|
| CLI refactoring | ~200 changed |
| azure/roles.ts | ~80 new |
| CLI Azure WIF module | ~60 new |
| Azure Bitbucket federation | ~30 in infrastructure |
| Workflow templates | ~100 each (4 files) |

## Client Handoff

At handoff, clients have two options:
1. **Delete unused cloud folder** (5 minutes) — simplest codebase
2. **Keep both** — flexibility if multi-cloud becomes relevant

Either way, the CLI commands and workflow patterns are identical across clouds.
