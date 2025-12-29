import { describe, it, expect } from "vitest";
import { normalizeBranch } from "./normalize.js";

describe("normalizeBranch", () => {
  it("converts to lowercase", () => {
    expect(normalizeBranch("Feature/ABC")).toBe("feature-abc");
  });

  it("replaces non-alphanumeric with hyphens", () => {
    expect(normalizeBranch("feature/API-123-new-auth")).toBe("feature-api-123-new-auth");
  });

  it("collapses multiple hyphens", () => {
    expect(normalizeBranch("feature//double")).toBe("feature-double");
  });

  it("removes leading and trailing hyphens", () => {
    expect(normalizeBranch("-leading-")).toBe("leading");
  });

  it("prepends b- if starts with number", () => {
    expect(normalizeBranch("123-feature")).toBe("b-123-feature");
  });

  it("truncates long names with hash", () => {
    const longBranch = "a".repeat(70);
    const result = normalizeBranch(longBranch);
    expect(result.length).toBeLessThanOrEqual(63);
    expect(result).toMatch(/^a+-[a-f0-9]{6}$/);
  });

  it("handles release version format", () => {
    expect(normalizeBranch("release/v1.2.3")).toBe("release-v1-2-3");
  });

  it("returns main as-is", () => {
    expect(normalizeBranch("main")).toBe("main");
  });
});
