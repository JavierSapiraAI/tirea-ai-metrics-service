# Metrics Service - AWS Infrastructure

This directory contains Terraform configuration for the metrics service AWS infrastructure.

## Resources Created

1. **IAM Role for GitHub Actions OIDC**
   - Role: `github-actions-metrics-service-deploy`
   - Allows GitHub Actions workflows to deploy without long-lived credentials
   - Permissions: ECR push, EKS describe, Secrets Manager read, CloudWatch Logs read

2. **IAM Role for Metrics Service (IRSA)**
   - Role: `metrics-service-s3-access`
   - Allows pods to access S3 without storing AWS credentials
   - Permissions: S3 read (ground truth bucket), CloudWatch Logs write

## Prerequisites

- AWS CLI configured with appropriate credentials
- Terraform >= 1.0
- S3 bucket for Terraform state: `langfuse-backoffice-terraform-state`
- DynamoDB table for state locking: `terraform-state-lock`
- Existing EKS cluster: `langfuse-backoffice-dev`
- GitHub OIDC provider configured in AWS

## Usage

### Initialize Terraform

```bash
cd terraform
terraform init
```

### Plan Changes

```bash
terraform plan
```

### Apply Changes

```bash
terraform apply
```

### Get Outputs

```bash
# Get GitHub Actions role ARN
terraform output github_actions_role_arn

# Get Metrics Service IRSA role ARN
terraform output metrics_service_irsa_role_arn

# Get all outputs
terraform output
```

## Configuration

Variables can be overridden by creating a `terraform.tfvars` file or using `-var` flags:

```hcl
# terraform.tfvars
environment = "dev"
eks_cluster_name = "langfuse-backoffice-dev"
github_org = "JavierSapiraAI"
github_repo = "tirea-ai-metrics-service"
```

## After Applying

1. **Update Kubernetes ServiceAccount** with the IRSA role ARN:
   ```bash
   terraform output metrics_service_irsa_role_arn
   # Copy the ARN and update k8s/serviceaccount.yaml
   ```

2. **Add GitHub Secrets** with the GitHub Actions role ARN:
   ```bash
   terraform output github_actions_role_arn
   # Add to GitHub repository secrets as AWS_GITHUB_ACTIONS_ROLE_ARN
   ```

## Clean Up

To destroy all resources:

```bash
terraform destroy
```

**Warning:** This will delete the IAM roles and revoke access.
