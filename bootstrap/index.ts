import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";

const config = new pulumi.Config();
const gcpConfig = new pulumi.Config("gcp");

const projectId = gcpConfig.require("project");
const region = config.get("region") || "us-central1";

// Common tags for all resources
const commonLabels = {
    "managed-by": "pulumi",
    "purpose": "state-storage",
    "stack": pulumi.getStack(),
};

// Enable required APIs
const storageApi = new gcp.projects.Service("storage-api", {
    service: "storage.googleapis.com",
    disableOnDestroy: false,
});

const kmsApi = new gcp.projects.Service("kms-api", {
    service: "cloudkms.googleapis.com",
    disableOnDestroy: false,
});

const iamApi = new gcp.projects.Service("iam-api", {
    service: "iam.googleapis.com",
    disableOnDestroy: false,
});

// KMS Key Ring for state encryption
const keyRing = new gcp.kms.KeyRing("pulumi-state-keyring", {
    name: "pulumi-state-keyring",
    location: region,
}, { dependsOn: [kmsApi] });

// KMS Crypto Key with 30-day rotation
const cryptoKey = new gcp.kms.CryptoKey("pulumi-state-key", {
    name: "pulumi-state-key",
    keyRing: keyRing.id,
    rotationPeriod: "2592000s", // 30 days
    purpose: "ENCRYPT_DECRYPT",
    versionTemplate: {
        algorithm: "GOOGLE_SYMMETRIC_ENCRYPTION",
        protectionLevel: "SOFTWARE",
    },
});

// GCS Bucket for Pulumi state
const stateBucket = new gcp.storage.Bucket("pulumi-state", {
    name: `${projectId}-pulumi-state`,
    location: region,
    uniformBucketLevelAccess: true,
    versioning: {
        enabled: true,
    },
    encryption: {
        defaultKmsKeyName: cryptoKey.id,
    },
    lifecycleRules: [{
        action: { type: "Delete" },
        condition: { numNewerVersions: 30 },
    }],
    labels: commonLabels,
}, { dependsOn: [storageApi] });

// Service Account for CI/CD deployments (used with Workload Identity Federation)
const deployServiceAccount = new gcp.serviceaccount.Account("deploy-sa", {
    accountId: "pulumi-deploy",
    displayName: "Pulumi CI/CD Deploy Service Account",
    description: "Service account for Pulumi deployments via Bitbucket Pipelines",
}, { dependsOn: [iamApi] });

// Grant the deploy SA permission to use the KMS key
const kmsKeyIamBinding = new gcp.kms.CryptoKeyIAMBinding("deploy-sa-kms-binding", {
    cryptoKeyId: cryptoKey.id,
    role: "roles/cloudkms.cryptoKeyEncrypterDecrypter",
    members: [pulumi.interpolate`serviceAccount:${deployServiceAccount.email}`],
});

// Grant the deploy SA permission to access the state bucket
const stateBucketIamBinding = new gcp.storage.BucketIAMBinding("deploy-sa-bucket-binding", {
    bucket: stateBucket.name,
    role: "roles/storage.objectAdmin",
    members: [pulumi.interpolate`serviceAccount:${deployServiceAccount.email}`],
});

// Grant GCS service agent permission to use the KMS key for bucket encryption
const projectNumber = gcp.organizations.getProjectOutput({ projectId });
const gcsServiceAgent = pulumi.interpolate`serviceAccount:service-${projectNumber.number}@gs-project-accounts.iam.gserviceaccount.com`;

const gcsKmsBinding = new gcp.kms.CryptoKeyIAMBinding("gcs-sa-kms-binding", {
    cryptoKeyId: cryptoKey.id,
    role: "roles/cloudkms.cryptoKeyEncrypterDecrypter",
    members: [gcsServiceAgent],
});

// Outputs
export const stateBucketName = stateBucket.name;
export const stateBucketUrl = pulumi.interpolate`gs://${stateBucket.name}`;
export const kmsKeyId = cryptoKey.id;
export const deployServiceAccountEmail = deployServiceAccount.email;
export const deployServiceAccountId = deployServiceAccount.id;
export const region_ = region;
export const projectId_ = projectId;

// Instructions for next steps
export const nextSteps = pulumi.interpolate`
Bootstrap complete!

State bucket: gs://${stateBucket.name}
Deploy SA: ${deployServiceAccount.email}

Next steps:
1. cd ../infrastructure
2. npm ci
3. pulumi login gs://${stateBucket.name}
4. pulumi stack select prod --create
5. pulumi config set gcp:project ${projectId}
6. pulumi config set deployServiceAccountEmail ${deployServiceAccount.email}
7. pulumi up
`;
