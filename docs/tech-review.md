# Technical Review: devops-pulumi-ts
*Last updated: 2026-01-03*

## Summary

Well-structured multi-cloud IaC project with strong security practices. The three-tier stack pattern (Bootstrap → Infrastructure → App) correctly separates state management from deployable resources. Custom IAM/RBAC roles implement least-privilege security.

**Key Metrics:**
- Files: 34 | Lines: ~4,600 (including new tests)
- Functions: 37 (avg 15 lines)
- CLI Tests: 79 passing | Coverage: 83% overall, 98% commands
- TypeScript: All stacks type-check cleanly

## Strengths

### Security Model
- **Custom IAM roles** replace broad predefined roles (`pulumiCloudRunDeploy` instead of `roles/run.admin`)
- **WIF authentication** eliminates stored credentials in CI/CD
- Deploy identity has **no access** to databases, secrets, or project-level IAM
- Both GCP and Azure use the same security pattern

### Architecture
- **Three-tier pattern** isolates state storage from deployable resources
- **StackReference** pattern allows app stacks to reference infrastructure outputs
- Conditional WIF providers support multiple CI/CD platforms per cloud
- Clean separation between GCP and Azure implementations

### Code Quality
- Consistent TypeScript patterns across all stacks
- Well-tested library code (normalization, validation, WIF, health checks)
- Pulumi mocking pattern enables stack testing without provisioning
- Clear error types with structured error handling

## Issues & Recommendations

| Priority | Issue | Impact | Recommendation |
|----------|-------|--------|----------------|
| ~~Medium~~ | ~~CLI commands lack test coverage~~ | ~~Deploy/cleanup logic untested~~ | **RESOLVED** - Added `deploy.test.ts` (26 tests) and `cleanup.test.ts` (16 tests) |
| ~~Low~~ | ~~Root package.json missing scripts~~ | ~~`devbot check` fails~~ | **RESOLVED** - Added `lint` and `build` scripts to root package.json |
| Low | Deep nesting in test files | Readability | Extract helper functions; test files flagged for 9-level nesting are acceptable for test setup |
| Low | Long test helper functions | 60-line functions in `azure/app/index.test.ts` | Acceptable for test setup; no action needed |

## Code Metrics Detail

### Complexity Flags
- **Long functions (>50 lines):** 2 in test files only (acceptable)
- **Deep nesting (>4 levels):** 13 files, primarily test setup and Pulumi resource definitions

### Test Coverage
```
src/commands     97.7% statements
  cleanup.ts     100%
  deploy.ts      96.82%

src/lib          85.48% statements
  normalize.ts   100%
  azure.ts       100%
  health.ts      97.77%
  gcp.ts         93.1%
  pulumi.ts      90.29%
  docker.ts      80%
  validation.ts  74.11%
```

## WIF Implementation Notes

**GCP:** Manual two-step token exchange
1. OIDC token → STS token (`sts.googleapis.com`)
2. STS token → Service Account access token (`iamcredentials.googleapis.com`)

**Azure:** Leverages `@azure/identity` SDK's built-in OIDC support
- `DefaultAzureCredential` handles token exchange automatically
- Code just validates environment variables are present

## Future Considerations

1. **Command integration tests** - Mock external calls (Docker, Pulumi CLI) to test deploy/cleanup flow
2. **Multi-repo GitHub federation** - Current Azure setup requires `githubRepo` config; could support wildcard patterns
3. **Custom domain validation** - Add domain ownership verification before attempting custom domain binding
