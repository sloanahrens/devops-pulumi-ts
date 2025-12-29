import { z } from "zod";

const deployEnvSchema = z.object({
  // Required
  GCP_PROJECT: z.string().min(1),
  GCP_PROJECT_NUMBER: z.string().min(1),
  GCP_REGION: z.string().min(1),
  STATE_BUCKET: z.string().min(1),
  SERVICE_ACCOUNT_EMAIL: z.string().min(1),
  PULUMI_CONFIG_PASSPHRASE: z.string().min(1),
  BITBUCKET_STEP_OIDC_TOKEN: z.string().min(1),
  // Optional with defaults
  WIF_POOL_ID: z.string().default("cicd-deployments"),
  WIF_PROVIDER_ID: z.string().default("bitbucket"),
});

export type DeployEnv = z.infer<typeof deployEnvSchema>;

export class DeployEnvError extends Error {
  constructor(public missingVars: string[]) {
    super(`Missing required environment variables: ${missingVars.join(", ")}`);
    this.name = "DeployEnvError";
  }
}

export function validateDeployEnv(env: Record<string, string | undefined>): DeployEnv {
  const result = deployEnvSchema.safeParse(env);

  if (!result.success) {
    const missingVars = result.error.issues
      .filter(issue => issue.code === "invalid_type" && issue.received === "undefined")
      .map(issue => issue.path[0] as string);

    if (missingVars.length > 0) {
      throw new DeployEnvError(missingVars);
    }

    throw new Error(`Environment validation failed: ${result.error.message}`);
  }

  return result.data;
}

export function formatMissingVarsError(error: DeployEnvError): string {
  const lines = [
    "==============================================",
    "ERROR: Missing required environment variables:",
    "==============================================",
    ...error.missingVars.map(v => `  - ${v}`),
    "",
    "Set these in: Repository Settings > Pipelines > Repository variables",
  ];
  return lines.join("\n");
}
