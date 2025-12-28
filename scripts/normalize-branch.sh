#!/bin/bash
# Converts branch names to DNS-safe labels for Cloud Run service names
#
# Cloud Run service names must:
# - Start with a letter
# - Contain only lowercase letters, numbers, and hyphens
# - Be at most 63 characters
# - Not end with a hyphen
#
# Examples:
#   feature/API-123-new-auth -> feature-api-123-new-auth
#   Feature/ABC -> feature-abc
#   release/v1.2.3 -> release-v1-2-3
#   very-long-branch-name-that-exceeds-the-limit -> truncated-with-hash

set -e

BRANCH="$1"

if [ -z "$BRANCH" ]; then
    echo "Usage: normalize-branch.sh <branch-name>" >&2
    exit 1
fi

# Convert to lowercase, replace non-alphanumeric with hyphens
NORMALIZED=$(echo "$BRANCH" | \
    tr '[:upper:]' '[:lower:]' | \
    sed 's/[^a-z0-9]/-/g' | \
    sed 's/--*/-/g' | \
    sed 's/^-//' | \
    sed 's/-$//')

# Ensure it starts with a letter (prepend 'b-' if it starts with a number)
if [[ "$NORMALIZED" =~ ^[0-9] ]]; then
    NORMALIZED="b-${NORMALIZED}"
fi

# Handle length limit (63 chars max)
if [ ${#NORMALIZED} -gt 63 ]; then
    # Truncate and append hash to avoid collisions
    HASH=$(echo -n "$BRANCH" | md5 2>/dev/null || echo -n "$BRANCH" | md5sum | cut -d' ' -f1)
    HASH=${HASH:0:6}
    NORMALIZED="${NORMALIZED:0:56}-${HASH}"
fi

# Final cleanup - ensure no trailing hyphen after truncation
NORMALIZED=$(echo "$NORMALIZED" | sed 's/-$//')

echo "$NORMALIZED"
