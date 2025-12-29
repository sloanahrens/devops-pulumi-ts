# Builder image for Bitbucket Pipelines deploying to GCP Cloud Run
# Pre-installs all dependencies to speed up pipeline execution
#
# Build and push:
#   docker build --platform linux/amd64 -t us-central1-docker.pkg.dev/PROJECT/apps-docker/pipeline-builder:latest builder/
#   docker push us-central1-docker.pkg.dev/PROJECT/apps-docker/pipeline-builder:latest

FROM node:22-alpine

# Install system dependencies
RUN apk add --no-cache \
    git \
    curl \
    jq \
    bash \
    ca-certificates

# Install Pulumi CLI
RUN curl -fsSL https://get.pulumi.com | sh
ENV PATH="/root/.pulumi/bin:${PATH}"

# Verify installations
RUN node --version && npm --version && pulumi version && git --version

# Set working directory
WORKDIR /app

LABEL maintainer="devops-gcp-pulumi"
LABEL description="Builder image for GCP Cloud Run deployments via Bitbucket Pipelines"
