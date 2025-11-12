# GitHub Repository Setup Guide

This guide explains how to configure your GitHub repository for the CI/CD pipeline.

## Prerequisites

- Repository created: https://github.com/JavierSapiraAI/tirea-ai-metrics-service
- Code pushed to main branch
- Terraform applied successfully (IAM roles created)
- AWS OIDC provider configured for GitHub Actions

## Step 1: Configure GitHub Secrets

GitHub secrets are NOT required for this setup because we use AWS OIDC authentication. However, if you want to add optional secrets:

1. Go to your repository on GitHub
2. Navigate to **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**

### Optional Secrets

These are already configured in the workflow, but you can override them if needed:

- `AWS_REGION` (default: eu-west-2)
- `AWS_ACCOUNT_ID` (default: 936389956156)
- `EKS_CLUSTER_NAME` (default: langfuse-backoffice-dev)

## Step 2: Create GitHub Environments

GitHub Environments allow you to set up approval gates and environment-specific configurations.

### Create Dev Environment

1. Go to **Settings** → **Environments**
2. Click **New environment**
3. Name it: `dev`
4. Configuration:
   - ✅ **Required reviewers**: None (auto-deploy)
   - ✅ **Wait timer**: 0 minutes
   - ✅ **Deployment branches**: Only main branch

### Create Stage Environment (Optional)

1. Click **New environment**
2. Name it: `stage`
3. Configuration:
   - ✅ **Required reviewers**: Add 1-2 team members
   - ✅ **Wait timer**: 0 minutes
   - ✅ **Deployment branches**: Only main branch

### Create Prod Environment (Optional)

1. Click **New environment**
2. Name it: `prod`
3. Configuration:
   - ✅ **Required reviewers**: Add 2+ team members
   - ✅ **Wait timer**: 5 minutes (optional)
   - ✅ **Deployment branches**: Only main branch or specific tags

## Step 3: Verify Terraform Outputs

Ensure the IAM roles were created successfully:

```bash
cd terraform
terraform output
```

You should see:

```
github_actions_role_arn = "arn:aws:iam::936389956156:role/github-actions-metrics-service-deploy"
metrics_service_irsa_role_arn = "arn:aws:iam::936389956156:role/metrics-service-s3-access"
```

## Step 4: Test the CI/CD Pipeline

### Option 1: Push to Main Branch

```bash
# Make a small change
echo "# Testing CI/CD" >> README.md
git add README.md
git commit -m "test: Trigger CI/CD pipeline"
git push origin main
```

### Option 2: Manual Workflow Dispatch

1. Go to **Actions** → **CI/CD - Metrics Service**
2. Click **Run workflow**
3. Select branch: `main`
4. Select environment: `dev`
5. Click **Run workflow**

## Step 5: Monitor the Deployment

1. Go to the **Actions** tab in your repository
2. Click on the running workflow
3. Monitor each job:
   - **Build and Test**: Installs deps, lints, tests, builds Docker image
   - **Push to ECR**: Authenticates via OIDC, pushes image to ECR
   - **Deploy to EKS**: Updates kubeconfig, applies K8s manifests, verifies health

## Step 6: Verify Deployment in AWS

### Check EKS Pods

```bash
kubectl get pods -n langfuse -l app=metrics-service
```

Expected output:
```
NAME                              READY   STATUS    RESTARTS   AGE
metrics-service-xxxxxxxxxx-xxxxx  1/1     Running   0          2m
```

### Check Logs

```bash
kubectl logs -n langfuse -l app=metrics-service --tail=100 -f
```

### Check Service

```bash
kubectl get svc -n langfuse metrics-service
```

### Test Health Endpoint

```bash
kubectl port-forward -n langfuse svc/metrics-service 3001:3001 &
curl http://localhost:3001/health
```

Expected response:
```json
{
  "status": "ok",
  "service": "metrics-service",
  "timestamp": "2025-11-12T..."
}
```

## Troubleshooting

### Pipeline Fails at "Configure AWS credentials"

**Symptoms:**
```
Error: Not authorized to perform sts:AssumeRoleWithWebIdentity
```

**Solutions:**
1. Verify GitHub OIDC provider exists in AWS IAM
2. Check the trust policy on the GitHub Actions IAM role
3. Ensure the repository name matches in the trust policy

### Pipeline Fails at "Push to ECR"

**Symptoms:**
```
Error: denied: User is not authorized to perform ecr:PutImage
```

**Solutions:**
1. Verify the IAM role has ECR push permissions
2. Check the ECR repository exists: `aws ecr describe-repositories --repository-names metrics-service`
3. Verify the role policy in Terraform

### Deployment Fails at "Wait for deployment rollout"

**Symptoms:**
```
Error: deployment rollout timed out
```

**Solutions:**
1. Check pod status: `kubectl get pods -n langfuse -l app=metrics-service`
2. Check pod logs: `kubectl logs -n langfuse -l app=metrics-service`
3. Check pod events: `kubectl describe pod -n langfuse -l app=metrics-service`
4. Common issues:
   - Image pull errors (check ECR permissions)
   - Secrets not available (check langfuse-secrets in namespace)
   - Resource limits (check node capacity)

### Health Check Fails

**Symptoms:**
```
Warning: Health check failed
```

**Solutions:**
1. Verify the service is listening on port 3001
2. Check application logs for errors
3. Verify environment variables are set correctly
4. Test locally: `kubectl exec -it <pod-name> -n langfuse -- wget -O- http://localhost:3001/health`

## Next Steps

After successful deployment:

1. ✅ Monitor CloudWatch logs
2. ✅ Set up CloudWatch alarms
3. ✅ Configure Slack/SNS notifications
4. ✅ Set up log aggregation
5. ✅ Create runbooks for common issues

## Security Best Practices

- ✅ Use OIDC authentication (no long-lived credentials)
- ✅ Use IRSA for pod permissions (no AWS credentials in pods)
- ✅ Enable ECR image scanning
- ✅ Use environment protection rules for prod
- ✅ Require approvals for production deployments
- ✅ Monitor IAM role usage in CloudTrail

## Resources

- [GitHub Actions OIDC with AWS](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/configuring-openid-connect-in-amazon-web-services)
- [EKS IRSA](https://docs.aws.amazon.com/eks/latest/userguide/iam-roles-for-service-accounts.html)
- [GitHub Environments](https://docs.github.com/en/actions/deployment/targeting-different-environments/using-environments-for-deployment)
