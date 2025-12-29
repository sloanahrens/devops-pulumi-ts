import { createHash } from "crypto";

/**
 * Converts branch names to DNS-safe labels for Cloud Run service names.
 *
 * Cloud Run service names must:
 * - Start with a letter
 * - Contain only lowercase letters, numbers, and hyphens
 * - Be at most 63 characters
 * - Not end with a hyphen
 */
export function normalizeBranch(branch: string): string {
  // Convert to lowercase, replace non-alphanumeric with hyphens
  let normalized = branch
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "-")
    .replace(/-+/g, "-") // Collapse multiple hyphens
    .replace(/^-/, "") // Remove leading hyphen
    .replace(/-$/, ""); // Remove trailing hyphen

  // Ensure it starts with a letter
  if (/^[0-9]/.test(normalized)) {
    normalized = `b-${normalized}`;
  }

  // Handle length limit (63 chars max)
  if (normalized.length > 63) {
    const hash = createHash("md5").update(branch).digest("hex").substring(0, 6);
    normalized = `${normalized.substring(0, 56)}-${hash}`;
  }

  // Final cleanup - ensure no trailing hyphen after truncation
  normalized = normalized.replace(/-$/, "");

  return normalized;
}
