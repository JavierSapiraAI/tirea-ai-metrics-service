#!/usr/bin/env python3
"""
Create IAM role for metrics-service with S3 access
"""

import boto3
import json

# Configuration
CLUSTER_NAME = "langfuse-backoffice-dev"
NAMESPACE = "langfuse"
SERVICE_ACCOUNT = "metrics-service"
POLICY_NAME = "MetricsServiceS3Access"
ROLE_NAME = f"eks-{CLUSTER_NAME}-{NAMESPACE}-{SERVICE_ACCOUNT}"
S3_BUCKET = "llm-evals-ground-truth-dev"
AWS_REGION = "eu-west-2"

# Initialize AWS clients
sts = boto3.client('sts', region_name=AWS_REGION)
iam = boto3.client('iam', region_name=AWS_REGION)
eks = boto3.client('eks', region_name=AWS_REGION)

# Get AWS account ID
account_id = sts.get_caller_identity()['Account']

print(f"AWS Account: {account_id}")
print(f"Region: {AWS_REGION}")
print(f"Cluster: {CLUSTER_NAME}")

# Step 1: Get OIDC provider for EKS cluster
print("\n[1/5] Getting EKS OIDC provider...")
cluster_info = eks.describe_cluster(name=CLUSTER_NAME)
oidc_issuer = cluster_info['cluster']['identity']['oidc']['issuer']
oidc_provider = oidc_issuer.replace('https://', '')
print(f"  OIDC Provider: {oidc_provider}")

# Step 2: Create IAM policy for S3 access
print("\n[2/5] Creating IAM policy for S3 access...")
policy_document = {
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "s3:GetObject",
                "s3:ListBucket"
            ],
            "Resource": [
                f"arn:aws:s3:::{S3_BUCKET}",
                f"arn:aws:s3:::{S3_BUCKET}/*"
            ]
        }
    ]
}

try:
    policy_response = iam.create_policy(
        PolicyName=POLICY_NAME,
        PolicyDocument=json.dumps(policy_document),
        Description="Allows metrics-service to read ground truth data from S3"
    )
    policy_arn = policy_response['Policy']['Arn']
    print(f"  Created policy: {policy_arn}")
except iam.exceptions.EntityAlreadyExistsException:
    policy_arn = f"arn:aws:iam::{account_id}:policy/{POLICY_NAME}"
    print(f"  Policy already exists: {policy_arn}")

# Step 3: Create IAM role with trust policy for EKS service account
print("\n[3/5] Creating IAM role...")
trust_policy = {
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Principal": {
                "Federated": f"arn:aws:iam::{account_id}:oidc-provider/{oidc_provider}"
            },
            "Action": "sts:AssumeRoleWithWebIdentity",
            "Condition": {
                "StringEquals": {
                    f"{oidc_provider}:sub": f"system:serviceaccount:{NAMESPACE}:{SERVICE_ACCOUNT}",
                    f"{oidc_provider}:aud": "sts.amazonaws.com"
                }
            }
        }
    ]
}

try:
    role_response = iam.create_role(
        RoleName=ROLE_NAME,
        AssumeRolePolicyDocument=json.dumps(trust_policy),
        Description="IAM role for metrics-service to access S3",
        MaxSessionDuration=3600
    )
    role_arn = role_response['Role']['Arn']
    print(f"  Created role: {role_arn}")
except iam.exceptions.EntityAlreadyExistsException:
    role_arn = f"arn:aws:iam::{account_id}:role/{ROLE_NAME}"
    print(f"  Role already exists: {role_arn}")

# Step 4: Attach policy to role
print("\n[4/5] Attaching policy to role...")
try:
    iam.attach_role_policy(
        RoleName=ROLE_NAME,
        PolicyArn=policy_arn
    )
    print("  Policy attached successfully")
except Exception as e:
    print(f"  Policy attachment: {e}")

# Step 5: Update service account annotation
print("\n[5/5] Updating Kubernetes service account...")
import subprocess

annotation_cmd = f"""kubectl annotate serviceaccount {SERVICE_ACCOUNT} \
  -n {NAMESPACE} \
  eks.amazonaws.com/role-arn={role_arn} \
  --overwrite"""

result = subprocess.run(annotation_cmd, shell=True, capture_output=True, text=True)
if result.returncode == 0:
    print(f"  Service account annotated with role ARN")
else:
    print(f"  Error: {result.stderr}")

print(f"\n[OK] IAM role setup complete!")
print(f"\nRole ARN: {role_arn}")
print(f"\nNext steps:")
print(f"  1. Restart deployment: kubectl rollout restart deployment/metrics-service -n {NAMESPACE}")
print(f"  2. Check logs: kubectl logs -n {NAMESPACE} -l app=metrics-service --tail=50")
