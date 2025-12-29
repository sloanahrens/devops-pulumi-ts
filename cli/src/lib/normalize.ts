import { createHash } from "crypto";

/**
 * Converts branch names to DNS-safe labels for container service names.
 *
 * Service name requirements:
 * - Start with a letter
 * - Contain only lowercase letters, numbers, and hyphens
 * - Be at most maxLength characters (GCP: 63, Azure: 32)
 * - Not end with a hyphen
 */
export function normalizeBranch(branch: string, maxLength: number = 63): string {
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

  // Handle length limit
  if (normalized.length > maxLength) {
    const hash = createHash("md5").update(branch).digest("hex").substring(0, 6);
    const truncateLength = maxLength - 7; // Leave room for "-" + 6-char hash
    normalized = `${normalized.substring(0, truncateLength)}-${hash}`;
  }

  // Final cleanup - ensure no trailing hyphen after truncation
  normalized = normalized.replace(/-$/, "");

  return normalized;
}
