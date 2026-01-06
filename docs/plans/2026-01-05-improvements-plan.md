# devops-pulumi-ts Improvements Plan

**Date:** 2026-01-05
**Status:** In Progress

## Overview

Five improvements to increase production confidence, security, and client handoff experience.

---

## 1. Fix Security Vulnerabilities (Low effort, Low impact)

**Issue:** 6 moderate-severity vulnerabilities in esbuild via vitest/vite chain.

**Current state:**
- vitest: ^2.1.0
- @vitest/coverage-v8: ^2.1.9
- All vulnerabilities are dev-only (don't affect production deployments)

**Fix:** Upgrade to vitest 4.x
```bash
cd cli && npm install vitest@4 @vitest/coverage-v8@4
npm audit
npm test
```

**Migration notes:** vitest 4.x has minimal breaking changes. Primary differences:
- Updated type exports (shouldn't affect our tests)
- New default behaviors (our explicit configs override defaults)

---

## 2. Add GCP Stack Tests (Medium effort, High impact)

**Issue:** Azure has 83 tests across 3 stacks. GCP has 0 tests.

**Current Azure test structure:**
```
azure/
├── bootstrap/index.test.ts    (16 tests)
├── infrastructure/index.test.ts (28 tests)
└── app/index.test.ts          (24 tests)
```

**GCP tests to create (matching Azure patterns):**

### gcp/bootstrap/index.test.ts (~16 tests)
- KMS API enabled
- Storage API enabled
- IAM API enabled
- KMS KeyRing created in correct region
- KMS CryptoKey with 30-day rotation
- GCS bucket with versioning enabled
- GCS bucket with KMS encryption
- GCS bucket lifecycle rules (30 versions)
- Deploy service account created
- Deploy SA has KMS key access
- Deploy SA has bucket access
- Exports: stateBucketName, stateBucketUrl, kmsKeyId, deployServiceAccountEmail

### gcp/infrastructure/index.test.ts (~24 tests)
- Artifact Registry API enabled
- Cloud Run API enabled
- IAM Credentials API enabled
- STS API enabled
- Artifact Registry repository created
- WIF Pool created
- Bitbucket WIF Provider (conditional)
- GitHub WIF Provider (conditional)
- WIF SA binding
- Custom Cloud Run deploy role
- Custom Artifact Registry role
- IAM bindings for deploy SA
- Cloud Run service agent binding
- Exports: registryUrl, wifPoolId, projectNumber, etc.

### gcp/app/index.test.ts (~20 tests)
- Cloud Run service created
- Service name construction (<63 chars)
- Container image URL format
- Container resources (CPU, memory)
- Container port configuration
- Health probes (startup, liveness)
- Scaling annotations (min/max instances)
- Traffic configuration (100% latest)
- IAM member for public access (conditional)
- Custom domain mapping (conditional)
- Exports: url, serviceName_, serviceId, latestRevision

**Test helper pattern (reusable):**
```typescript
const resources: Array<{ type: string; name: string; inputs: Record<string, unknown> }> = [];

pulumi.runtime.setMocks({
  newResource: (args) => {
    resources.push({ type: args.type, name: args.name, inputs: args.inputs });
    return { id: `${args.name}-id`, state: { ...args.inputs } };
  },
  call: (args) => {
    // Mock GCP API calls
  },
});
```

---

## 3. Implement bootstrap.sh Wizard (Medium effort, High impact for clients)

**Purpose:** Single interactive script for first-time setup.

**Flow:**
```
$ ./scripts/bootstrap.sh

Welcome to devops-pulumi-ts!

Which cloud provider? [gcp/azure]: gcp
GCP Project ID: my-project-123
Region [us-central1]:
Bitbucket workspace UUID (or skip): {uuid-here}
GitHub org (or skip):

Creating bootstrap stack...
✓ Pulumi installed
✓ Logged in (local state)
✓ Stack created: prod
✓ Config set

Run `pulumi up` to create resources.
```

**Implementation:**
```bash
#!/bin/bash
set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

# Check prerequisites
command -v pulumi >/dev/null || { echo "Installing Pulumi..."; curl -fsSL https://get.pulumi.com | sh; }
command -v npm >/dev/null || { echo "Error: npm required"; exit 1; }

# Interactive prompts
read -p "Cloud provider [gcp/azure]: " CLOUD
# ... continue with cloud-specific prompts
```

**File:** `scripts/bootstrap.sh` (~100 lines)

---

## 4. Refactor Long Test Helpers (Low effort, Low impact)

**Issue:** Two test helper functions exceed 50 lines:
- `azure/app/index.test.ts:158` - getProbes (60 lines)
- `azure/app/index.test.ts:218` - getScale (58 lines)

**Analysis:** These are actually short helper functions (5-6 lines each). The "60 lines" count includes all the tests that USE them. The helpers themselves are fine:

```typescript
// getProbes - actually 6 lines
function getProbes() {
  const containerApp = resources.find(r => r.type === "azure-native:app:ContainerApp");
  const template = containerApp?.inputs.template as Record<string, unknown>;
  const containers = template?.containers as Array<{ probes: Array<Record<string, unknown>> }>;
  return containers?.[0]?.probes || [];
}
```

**Conclusion:** No refactoring needed. The devbot stats tool counts test blocks, not just the helper function. Mark as N/A.

---

## 5. Document Deployment in README (Low effort, Medium impact)

**Current:** README exists but may lack quick-start for both clouds.

**Add sections:**
- Quick Start (GCP)
- Quick Start (Azure)
- Environment variables table
- Common issues / FAQ

**Target:** ~50 lines added to README.md

---

## Implementation Order

| Task | Priority | Effort | Status |
|------|----------|--------|--------|
| 2. GCP tests | High | Medium | **In Progress** |
| 1. Vitest upgrade | Medium | Low | Pending |
| 3. bootstrap.sh | Medium | Medium | Pending |
| 5. README docs | Low | Low | Pending |
| 4. Test refactor | N/A | N/A | Skipped (false positive) |

---

## Success Criteria

- [ ] All GCP stacks have test files matching Azure patterns
- [ ] `npm audit` shows 0 vulnerabilities
- [ ] `./scripts/bootstrap.sh` completes successfully for both clouds
- [ ] README has quick-start sections for GCP and Azure
