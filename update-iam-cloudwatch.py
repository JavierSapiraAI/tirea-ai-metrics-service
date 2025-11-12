#!/usr/bin/env python3
"""
Add CloudWatch PutMetricData permissions to the metrics service IAM role
"""

import json
import subprocess
import sys

class Colors:
    GREEN = '\033[92m'
    YELLOW = '\033[93m'
    RED = '\033[91m'
    BLUE = '\033[94m'
    NC = '\033[0m'

def run_command(cmd, description):
    """Run a shell command and return the output"""
    print(f"{Colors.YELLOW}{description}{Colors.NC}")
    try:
        result = subprocess.run(
            cmd,
            shell=True,
            check=True,
            capture_output=True,
            text=True
        )
        return result.stdout.strip()
    except subprocess.CalledProcessError as e:
        print(f"{Colors.RED}[ERROR] {description} failed{Colors.NC}")
        print(e.stderr)
        raise

def print_success(message):
    print(f"{Colors.GREEN}[OK] {message}{Colors.NC}")

def print_step(message):
    print(f"\n{Colors.BLUE}=== {message} ==={Colors.NC}\n")

def main():
    print_step("Adding CloudWatch Permissions to Metrics Service IAM Role")

    role_name = "eks-langfuse-backoffice-dev-langfuse-metrics-service"
    policy_name = "CloudWatchMetricsPolicy"

    # CloudWatch PutMetricData policy
    policy_document = {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Effect": "Allow",
                "Action": [
                    "cloudwatch:PutMetricData"
                ],
                "Resource": "*",
                "Condition": {
                    "StringEquals": {
                        "cloudwatch:namespace": [
                            "LangfuseMetricsService/dev",
                            "LangfuseMetricsService/prod"
                        ]
                    }
                }
            }
        ]
    }

    # Convert policy to JSON string
    policy_json = json.dumps(policy_document)

    # Check if role exists
    print_step("Step 1: Verifying IAM role")
    try:
        run_command(
            f"aws iam get-role --role-name {role_name}",
            f"Checking role '{role_name}'..."
        )
        print_success(f"IAM role found: {role_name}")
    except:
        print(f"{Colors.RED}[ERROR] IAM role not found: {role_name}{Colors.NC}")
        sys.exit(1)

    # Put inline policy
    print_step("Step 2: Adding CloudWatch policy")
    run_command(
        f"aws iam put-role-policy --role-name {role_name} --policy-name {policy_name} --policy-document '{policy_json}'",
        f"Adding policy '{policy_name}'..."
    )
    print_success(f"CloudWatch policy added to role {role_name}")

    # Verify policy
    print_step("Step 3: Verifying policy")
    policy_output = run_command(
        f"aws iam get-role-policy --role-name {role_name} --policy-name {policy_name}",
        "Verifying policy..."
    )
    print_success("Policy verified successfully")

    # Summary
    print_step("IAM Update Complete")
    print(f"{Colors.GREEN}CloudWatch permissions added successfully!{Colors.NC}\n")
    print("Permissions granted:")
    print("  - cloudwatch:PutMetricData")
    print("\nNamespaces allowed:")
    print("  - LangfuseMetricsService/dev")
    print("  - LangfuseMetricsService/prod")
    print("\nThe metrics service can now publish CloudWatch metrics.")

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"{Colors.RED}[ERROR] IAM update failed: {e}{Colors.NC}")
        sys.exit(1)
