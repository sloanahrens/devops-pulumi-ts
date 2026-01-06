import { describe, it, expect, beforeAll } from "vitest";
import * as pulumi from "@pulumi/pulumi";

// Store created resources for assertions
const resources: Array<{ type: string; name: string; inputs: Record<string, unknown> }> = [];

// Set required config values BEFORE setting mocks
pulumi.runtime.setAllConfig({
    "gcp:project": "test-project-123",
    "project:region": "us-central1",
});

// Mock Pulumi runtime
pulumi.runtime.setMocks(
    {
        newResource: (args: pulumi.runtime.MockResourceArgs) => {
            resources.push({
                type: args.type,
                name: args.name,
                inputs: args.inputs,
            });

            const defaults: Record<string, unknown> = {};

            if (args.type === "gcp:storage/bucket:Bucket") {
                defaults.name = args.inputs.name || args.name;
            }
            if (args.type === "gcp:serviceaccount/account:Account") {
                defaults.email = `${args.inputs.accountId}@test-project-123.iam.gserviceaccount.com`;
            }
            if (args.type === "gcp:kms/keyRing:KeyRing") {
                defaults.id = `projects/test-project-123/locations/us-central1/keyRings/${args.inputs.name}`;
            }
            if (args.type === "gcp:kms/cryptoKey:CryptoKey") {
                defaults.id = `projects/test-project-123/locations/us-central1/keyRings/pulumi-state-keyring/cryptoKeys/${args.inputs.name}`;
            }

            return {
                id: `${args.name}-id`,
                state: { ...args.inputs, ...defaults },
            };
        },
        call: (args: pulumi.runtime.MockCallArgs) => {
            if (args.token === "gcp:organizations/getProject:getProject") {
                return {
                    projectId: "test-project-123",
                    number: "123456789",
                };
            }
            return {};
        },
    },
    "project",
    "stack",
    false
);

// Helper function to convert pulumi.Output to a promise
function promiseOf<T>(output: pulumi.Output<T>): Promise<T> {
    return new Promise(resolve => output.apply(resolve));
}

describe("Bootstrap Stack", () => {
    let outputs: typeof import("./index");

    beforeAll(async () => {
        outputs = await import("./index");
        // Wait for all resources to be created
        await Promise.all([
            promiseOf(outputs.stateBucketName),
            promiseOf(outputs.stateBucketUrl),
            promiseOf(outputs.kmsKeyId),
            promiseOf(outputs.deployServiceAccountEmail),
        ]);
    });

    describe("API Services", () => {
        it("should enable Storage API", () => {
            const api = resources.find(
                r => r.type === "gcp:projects/service:Service" && r.inputs.service === "storage.googleapis.com"
            );
            expect(api).toBeDefined();
            expect(api?.inputs.disableOnDestroy).toBe(false);
        });

        it("should enable KMS API", () => {
            const api = resources.find(
                r => r.type === "gcp:projects/service:Service" && r.inputs.service === "cloudkms.googleapis.com"
            );
            expect(api).toBeDefined();
        });

        it("should enable IAM API", () => {
            const api = resources.find(
                r => r.type === "gcp:projects/service:Service" && r.inputs.service === "iam.googleapis.com"
            );
            expect(api).toBeDefined();
        });
    });

    describe("KMS Resources", () => {
        it("should create KMS key ring in correct region", () => {
            const keyRing = resources.find(r => r.type === "gcp:kms/keyRing:KeyRing");
            expect(keyRing).toBeDefined();
            expect(keyRing?.inputs.name).toBe("pulumi-state-keyring");
            expect(keyRing?.inputs.location).toBe("us-central1");
        });

        it("should create KMS crypto key with 30-day rotation", () => {
            const key = resources.find(r => r.type === "gcp:kms/cryptoKey:CryptoKey");
            expect(key).toBeDefined();
            expect(key?.inputs.name).toBe("pulumi-state-key");
            expect(key?.inputs.rotationPeriod).toBe("2592000s"); // 30 days
            expect(key?.inputs.purpose).toBe("ENCRYPT_DECRYPT");
        });

        it("should use symmetric encryption algorithm", () => {
            const key = resources.find(r => r.type === "gcp:kms/cryptoKey:CryptoKey");
            const template = key?.inputs.versionTemplate as Record<string, unknown>;
            expect(template?.algorithm).toBe("GOOGLE_SYMMETRIC_ENCRYPTION");
            expect(template?.protectionLevel).toBe("SOFTWARE");
        });

        it("should grant GCS service agent access to KMS key", () => {
            const binding = resources.find(
                r => r.type === "gcp:kms/cryptoKeyIAMBinding:CryptoKeyIAMBinding" &&
                     r.name === "gcs-sa-kms-binding"
            );
            expect(binding).toBeDefined();
            expect(binding?.inputs.role).toBe("roles/cloudkms.cryptoKeyEncrypterDecrypter");
        });
    });

    describe("GCS Bucket", () => {
        it("should create state bucket with project prefix", () => {
            const bucket = resources.find(r => r.type === "gcp:storage/bucket:Bucket");
            expect(bucket).toBeDefined();
            expect(bucket?.inputs.name).toBe("test-project-123-pulumi-state");
        });

        it("should enable versioning", () => {
            const bucket = resources.find(r => r.type === "gcp:storage/bucket:Bucket");
            const versioning = bucket?.inputs.versioning as Record<string, unknown>;
            expect(versioning?.enabled).toBe(true);
        });

        it("should use uniform bucket-level access", () => {
            const bucket = resources.find(r => r.type === "gcp:storage/bucket:Bucket");
            expect(bucket?.inputs.uniformBucketLevelAccess).toBe(true);
        });

        it("should configure KMS encryption", () => {
            const bucket = resources.find(r => r.type === "gcp:storage/bucket:Bucket");
            const encryption = bucket?.inputs.encryption as Record<string, unknown>;
            expect(encryption?.defaultKmsKeyName).toBeDefined();
        });

        it("should set lifecycle rule for version cleanup", () => {
            const bucket = resources.find(r => r.type === "gcp:storage/bucket:Bucket");
            const rules = bucket?.inputs.lifecycleRules as Array<Record<string, unknown>>;
            expect(rules).toHaveLength(1);
            const condition = rules?.[0]?.condition as Record<string, unknown>;
            expect(condition?.numNewerVersions).toBe(30);
        });

        it("should apply correct labels", () => {
            const bucket = resources.find(r => r.type === "gcp:storage/bucket:Bucket");
            expect(bucket?.inputs.labels).toMatchObject({
                "managed-by": "pulumi",
                "purpose": "state-storage",
            });
        });
    });

    describe("Deploy Service Account", () => {
        it("should create deploy service account", () => {
            const sa = resources.find(r => r.type === "gcp:serviceaccount/account:Account");
            expect(sa).toBeDefined();
            expect(sa?.inputs.accountId).toBe("pulumi-deploy");
            expect(sa?.inputs.displayName).toBe("Pulumi CI/CD Deploy Service Account");
        });

        it("should grant deploy SA access to KMS key", () => {
            const binding = resources.find(
                r => r.type === "gcp:kms/cryptoKeyIAMBinding:CryptoKeyIAMBinding" &&
                     r.name === "deploy-sa-kms-binding"
            );
            expect(binding).toBeDefined();
            expect(binding?.inputs.role).toBe("roles/cloudkms.cryptoKeyEncrypterDecrypter");
        });

        it("should grant deploy SA access to state bucket", () => {
            const binding = resources.find(r => r.type === "gcp:storage/bucketIAMBinding:BucketIAMBinding");
            expect(binding).toBeDefined();
            expect(binding?.inputs.role).toBe("roles/storage.objectAdmin");
        });
    });

    describe("Exports", () => {
        it("should export stateBucketName", async () => {
            const value = await promiseOf(outputs.stateBucketName);
            expect(value).toBe("test-project-123-pulumi-state");
        });

        it("should export stateBucketUrl in gs:// format", async () => {
            const value = await promiseOf(outputs.stateBucketUrl);
            expect(value).toMatch(/^gs:\/\//);
        });

        it("should export kmsKeyId", async () => {
            const value = await promiseOf(outputs.kmsKeyId);
            expect(value).toBeDefined();
        });

        it("should export deployServiceAccountEmail", async () => {
            const value = await promiseOf(outputs.deployServiceAccountEmail);
            expect(value).toContain("@test-project-123.iam.gserviceaccount.com");
        });

        it("should export region", () => {
            expect(outputs.region_).toBe("us-central1");
        });

        it("should export projectId", () => {
            expect(outputs.projectId_).toBe("test-project-123");
        });
    });
});
