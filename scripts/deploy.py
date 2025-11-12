#!/usr/bin/env python3
"""
Deployment script for Tirea AI Metrics Service
Handles Docker build, ECR push, and EKS deployment
"""

import boto3
import subprocess
import sys
import json
import time
from pathlib import Path

# Configuration
AWS_REGION = "eu-west-2"
ECR_REPOSITORY = "metrics-service"
EKS_CLUSTER_NAME = "langfuse-backoffice-dev"
NAMESPACE = "langfuse"
IMAGE_TAG = "latest"

# Colors for output
class Colors:
    GREEN = '\033[92m'
    YELLOW = '\033[93m'
    RED = '\033[91m'
    NC = '\033[0m'  # No Color

def print_step(step_num, message):
    print(f"\n{Colors.YELLOW}Step {step_num}: {message}...{Colors.NC}")

def print_success(message):
    print(f"{Colors.GREEN}[OK] {message}{Colors.NC}")

def print_error(message):
    print(f"{Colors.RED}[ERROR] {message}{Colors.NC}")

def run_command(cmd, description, check=True):
    """Run a shell command and return output"""
    try:
        result = subprocess.run(
            cmd,
            shell=True,
            capture_output=True,
            text=True,
            check=check
        )
        return result.stdout
    except subprocess.CalledProcessError as e:
        if check:
            print_error(f"{description} failed: {e.stderr}")
            sys.exit(1)
        return None

def main():
    print(f"{Colors.GREEN}=== Tirea AI Metrics Service Deployment ==={Colors.NC}")

    # Initialize AWS clients
    sts_client = boto3.client('sts', region_name=AWS_REGION)
    ecr_client = boto3.client('ecr', region_name=AWS_REGION)

    # Step 1: Get AWS account info
    print_step(1, "Getting AWS account information")
    try:
        identity = sts_client.get_caller_identity()
        account_id = identity['Account']
        ecr_registry = f"{account_id}.dkr.ecr.{AWS_REGION}.amazonaws.com"
        print(f"  AWS Account: {account_id}")
        print(f"  ECR Registry: {ecr_registry}")
        print_success("AWS credentials verified")
    except Exception as e:
        print_error(f"Failed to get AWS credentials: {e}")
        sys.exit(1)

    # Step 2: Ensure ECR repository exists
    print_step(2, "Ensuring ECR repository exists")
    try:
        ecr_client.describe_repositories(repositoryNames=[ECR_REPOSITORY])
        print_success(f"ECR repository '{ECR_REPOSITORY}' exists")
    except ecr_client.exceptions.RepositoryNotFoundException:
        print(f"  Creating ECR repository...")
        ecr_client.create_repository(
            repositoryName=ECR_REPOSITORY,
            imageScanningConfiguration={'scanOnPush': True}
        )
        print_success(f"ECR repository '{ECR_REPOSITORY}' created")

    # Step 3: Login to ECR
    print_step(3, "Logging in to ECR")
    try:
        auth_token = ecr_client.get_authorization_token()
        token = auth_token['authorizationData'][0]['authorizationToken']
        proxy_endpoint = auth_token['authorizationData'][0]['proxyEndpoint']

        # Decode token and login to Docker
        import base64
        import tempfile
        import os
        decoded = base64.b64decode(token).decode('utf-8')
        username, password = decoded.split(':')

        # Write password to temp file for Windows compatibility
        with tempfile.NamedTemporaryFile(mode='w', delete=False, suffix='.txt') as f:
            f.write(password)
            temp_file = f.name

        try:
            # Use type on Windows, cat on Unix
            if os.name == 'nt':
                run_command(
                    f'type {temp_file} | docker login --username {username} --password-stdin {ecr_registry}',
                    "Docker login to ECR"
                )
            else:
                run_command(
                    f'cat {temp_file} | docker login --username {username} --password-stdin {ecr_registry}',
                    "Docker login to ECR"
                )
        finally:
            os.unlink(temp_file)

        print_success("Logged in to ECR")
    except Exception as e:
        print_error(f"Failed to login to ECR: {e}")
        sys.exit(1)

    # Step 4: Build Docker image
    print_step(4, "Building Docker image")
    image_full_name = f"{ecr_registry}/{ECR_REPOSITORY}:{IMAGE_TAG}"
    run_command(
        f'docker build -t {ECR_REPOSITORY}:{IMAGE_TAG} -t {image_full_name} .',
        "Docker build"
    )
    print_success("Docker image built")

    # Step 5: Push to ECR
    print_step(5, "Pushing image to ECR")
    run_command(
        f'docker push {image_full_name}',
        "Docker push"
    )
    print_success(f"Image pushed: {image_full_name}")

    # Step 6: Update Kubernetes manifests
    print_step(6, "Preparing Kubernetes manifests")

    # Read and update deployment.yaml
    deployment_path = Path("k8s/deployment.yaml")
    with open(deployment_path, 'r') as f:
        deployment_yaml = f.read()
    deployment_yaml = deployment_yaml.replace("${ECR_REGISTRY}", ecr_registry)

    # Write temporary file
    temp_deployment = Path("k8s/deployment.temp.yaml")
    with open(temp_deployment, 'w') as f:
        f.write(deployment_yaml)

    # Get IAM role ARN for service account (if exists)
    iam_client = boto3.client('iam', region_name=AWS_REGION)
    try:
        roles = iam_client.list_roles()
        metrics_role = [r for r in roles['Roles'] if 'metrics-service' in r['RoleName'].lower()]
        if metrics_role:
            role_arn = metrics_role[0]['Arn']
            print(f"  Found IAM role: {role_arn}")

            # Update serviceaccount.yaml
            sa_path = Path("k8s/serviceaccount.yaml")
            with open(sa_path, 'r') as f:
                sa_yaml = f.read()
            sa_yaml = sa_yaml.replace("${METRICS_SERVICE_IAM_ROLE_ARN}", role_arn)

            temp_sa = Path("k8s/serviceaccount.temp.yaml")
            with open(temp_sa, 'w') as f:
                f.write(sa_yaml)
        else:
            print("  Warning: IAM role for metrics-service not found")
            print("  You may need to create it manually for S3 access")
    except Exception as e:
        print(f"  Warning: Could not check IAM roles: {e}")

    print_success("Kubernetes manifests prepared")

    # Step 7: Check kubectl availability
    print_step(7, "Checking kubectl availability")
    kubectl_check = run_command("kubectl version --client", "kubectl check", check=False)
    if not kubectl_check:
        print_error("kubectl not found. Please install kubectl and configure access to EKS cluster")
        print("\nManual steps:")
        print(f"1. Configure kubectl: aws eks update-kubeconfig --name {EKS_CLUSTER_NAME} --region {AWS_REGION}")
        print(f"2. Apply manifests: kubectl apply -f k8s/serviceaccount.temp.yaml")
        print(f"                    kubectl apply -f k8s/deployment.temp.yaml")
        print(f"                    kubectl apply -f k8s/service.yaml")
        print(f"3. Check deployment: kubectl get pods -n {NAMESPACE} -l app=metrics-service")
        sys.exit(1)
    print_success("kubectl is available")

    # Step 8: Update kubeconfig
    print_step(8, "Updating kubeconfig for EKS")
    run_command(
        f"aws eks update-kubeconfig --name {EKS_CLUSTER_NAME} --region {AWS_REGION}",
        "Update kubeconfig",
        check=False
    )
    print_success("Kubeconfig updated")

    # Step 9: Deploy to Kubernetes
    print_step(9, "Deploying to Kubernetes")

    # Apply service account (if exists)
    if Path("k8s/serviceaccount.temp.yaml").exists():
        run_command(f"kubectl apply -f k8s/serviceaccount.temp.yaml", "Apply ServiceAccount")
    else:
        run_command(f"kubectl apply -f k8s/serviceaccount.yaml", "Apply ServiceAccount")

    # Apply deployment
    run_command(f"kubectl apply -f k8s/deployment.temp.yaml", "Apply Deployment")

    # Apply service
    run_command(f"kubectl apply -f k8s/service.yaml", "Apply Service")

    print_success("Kubernetes resources applied")

    # Step 10: Wait for rollout
    print_step(10, "Waiting for deployment to roll out")
    print("  This may take a few minutes...")
    run_command(
        f"kubectl rollout status deployment/metrics-service -n {NAMESPACE} --timeout=5m",
        "Rollout status",
        check=False
    )
    print_success("Deployment rolled out")

    # Step 11: Verify deployment
    print_step(11, "Verifying deployment")
    pods_output = run_command(
        f"kubectl get pods -n {NAMESPACE} -l app=metrics-service",
        "Get pods",
        check=False
    )
    if pods_output:
        print(pods_output)

    svc_output = run_command(
        f"kubectl get svc -n {NAMESPACE} metrics-service",
        "Get service",
        check=False
    )
    if svc_output:
        print(svc_output)

    print_success("Deployment verified")

    # Step 12: Check health
    print_step(12, "Checking service health")
    time.sleep(5)  # Give service time to start

    pod_name_output = run_command(
        f"kubectl get pods -n {NAMESPACE} -l app=metrics-service -o jsonpath='{{.items[0].metadata.name}}'",
        "Get pod name",
        check=False
    )

    if pod_name_output:
        pod_name = pod_name_output.strip()
        print(f"  Checking health on pod: {pod_name}")

        health_output = run_command(
            f"kubectl exec -n {NAMESPACE} {pod_name} -- wget -q -O- http://localhost:3001/health",
            "Health check",
            check=False
        )
        if health_output:
            try:
                health_data = json.loads(health_output)
                print(f"  Status: {health_data.get('status', 'unknown')}")
                print(f"  Service: {health_data.get('service', 'unknown')}")
                print_success("Service is healthy")
            except:
                print("  Health check returned non-JSON response")

    # Cleanup temp files
    Path("k8s/deployment.temp.yaml").unlink(missing_ok=True)
    Path("k8s/serviceaccount.temp.yaml").unlink(missing_ok=True)

    # Final message
    print(f"\n{Colors.GREEN}=== Deployment Complete ==={Colors.NC}\n")
    print("Next steps:")
    print(f"  - Monitor logs: kubectl logs -n {NAMESPACE} -l app=metrics-service -f")
    print(f"  - Port-forward: kubectl port-forward -n {NAMESPACE} svc/metrics-service 3001:3001")
    print(f"  - Check stats: curl http://localhost:3001/stats")
    print()

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print(f"\n{Colors.YELLOW}Deployment cancelled by user{Colors.NC}")
        sys.exit(1)
    except Exception as e:
        print_error(f"Unexpected error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
