#!/usr/bin/env python3
"""
Verify IAM CloudWatch policy is attached
"""

import boto3
import json

def verify_policy():
    iam = boto3.client('iam')
    role_name = "eks-langfuse-backoffice-dev-langfuse-metrics-service"
    policy_name = "CloudWatchMetricsPolicy"

    print(f"\n=== Verifying IAM Policy ===")
    print(f"Role: {role_name}")
    print(f"Policy: {policy_name}\n")

    try:
        # Get the inline policy
        response = iam.get_role_policy(
            RoleName=role_name,
            PolicyName=policy_name
        )

        policy_doc = response['PolicyDocument']
        print(f"[OK] Policy found!")
        print(f"\nPolicy Document:")
        print(json.dumps(policy_doc, indent=2))

        # Check if PutMetricData is in the policy
        for statement in policy_doc.get('Statement', []):
            actions = statement.get('Action', [])
            if 'cloudwatch:PutMetricData' in actions:
                print(f"\n[OK] cloudwatch:PutMetricData permission found")

                # Check namespace condition
                condition = statement.get('Condition', {})
                string_equals = condition.get('StringEquals', {})
                namespaces = string_equals.get('cloudwatch:namespace', [])

                if 'LangfuseMetricsService/dev' in namespaces:
                    print(f"[OK] Namespace 'LangfuseMetricsService/dev' allowed")
                else:
                    print(f"[WARNING] Namespace 'LangfuseMetricsService/dev' NOT in allowed list")
                    print(f"Allowed namespaces: {namespaces}")
            else:
                print(f"[WARNING] cloudwatch:PutMetricData NOT found in statement")

    except iam.exceptions.NoSuchEntityException:
        print(f"[ERROR] Policy '{policy_name}' not found on role '{role_name}'")
        print(f"\nListing all inline policies on role:")
        try:
            policies = iam.list_role_policies(RoleName=role_name)
            for policy in policies['PolicyNames']:
                print(f"  - {policy}")
        except Exception as e:
            print(f"[ERROR] Could not list policies: {e}")
    except Exception as e:
        print(f"[ERROR] {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    verify_policy()
