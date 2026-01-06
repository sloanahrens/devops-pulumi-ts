# Bootstrap Wizard Plan

**Date:** 2026-01-05
**Status:** Pending

## Purpose

Interactive shell script for first-time setup. Handles prerequisites, prompts for configuration, and creates the bootstrap stack.

## User Flow

```
$ ./scripts/bootstrap.sh

╭─────────────────────────────────────────╮
│  devops-pulumi-ts Setup Wizard          │
╰─────────────────────────────────────────╯

Checking prerequisites...
✓ Node.js v20+
✓ npm
✓ Pulumi CLI (or installing...)

Which cloud provider?
  [1] GCP Cloud Run
  [2] Azure Container Apps
> 1

GCP Project ID: my-project-123
Region [us-central1]:

CI/CD Provider(s):
  [1] Bitbucket Pipelines
  [2] GitHub Actions
  [3] Both
> 3

Bitbucket workspace UUID: {uuid-here}
Bitbucket workspace slug: my-workspace
GitHub org/username: my-org

Creating bootstrap stack...
✓ pulumi login --local
✓ pulumi stack init prod
✓ pulumi config set gcp:project my-project-123
✓ pulumi config set project:region us-central1

Ready! Run: cd gcp/bootstrap && pulumi up
```

## Implementation (~100 lines)

```bash
#!/bin/bash
set -euo pipefail

# 1. Colors and helpers (10 lines)
RED='\033[0;31m'; GREEN='\033[0;32m'; BLUE='\033[0;34m'; NC='\033[0m'
check() { printf "${GREEN}✓${NC} %s\n" "$1"; }
fail() { printf "${RED}✗${NC} %s\n" "$1"; exit 1; }

# 2. Prerequisites check (15 lines)
echo "Checking prerequisites..."
command -v node >/dev/null || fail "Node.js required (v20+)"
command -v npm >/dev/null || fail "npm required"
if ! command -v pulumi >/dev/null; then
    echo "Installing Pulumi..."
    curl -fsSL https://get.pulumi.com | sh
fi
check "All prerequisites met"

# 3. Cloud selection (10 lines)
echo ""
echo "Which cloud provider?"
select CLOUD in "GCP" "Azure"; do
    case $CLOUD in
        GCP) DIR="gcp/bootstrap"; break;;
        Azure) DIR="azure/bootstrap"; break;;
    esac
done

# 4. Cloud-specific prompts (25 lines)
if [[ $CLOUD == "GCP" ]]; then
    read -p "GCP Project ID: " PROJECT_ID
    [[ -z "$PROJECT_ID" ]] && fail "Project ID required"
    read -p "Region [us-central1]: " REGION
    REGION=${REGION:-us-central1}
else
    read -p "Resource Group Name: " RESOURCE_GROUP
    [[ -z "$RESOURCE_GROUP" ]] && fail "Resource group required"
fi

# 5. CI/CD provider prompts (20 lines)
echo ""
echo "CI/CD Provider(s)?"
select CICD in "Bitbucket" "GitHub" "Both"; do
    case $CICD in
        Bitbucket|Both)
            read -p "Bitbucket workspace UUID: " BB_UUID
            read -p "Bitbucket workspace slug: " BB_SLUG
            ;;&
        GitHub|Both)
            read -p "GitHub org/username: " GH_OWNER
            ;;
    esac
    break
done

# 6. Stack creation (20 lines)
echo ""
echo "Creating bootstrap stack..."
cd "$DIR"
npm install
pulumi login --local
pulumi stack init prod 2>/dev/null || pulumi stack select prod

if [[ $CLOUD == "GCP" ]]; then
    pulumi config set gcp:project "$PROJECT_ID"
    pulumi config set project:region "$REGION"
else
    pulumi config set project:resourceGroupName "$RESOURCE_GROUP"
fi

check "Stack configured"
echo ""
echo "Run: cd $DIR && pulumi up"
```

## File Location

`scripts/bootstrap.sh`

## Key Features

1. **Idempotent** - Safe to run multiple times
2. **Validates inputs** - Checks required fields
3. **Handles both clouds** - Single entry point
4. **CI/CD agnostic** - Supports Bitbucket, GitHub, or both
5. **Minimal prompts** - Uses sensible defaults

## Priority

Low - The README provides complete manual instructions. This is convenience sugar for less technical users or faster setup.
