#!/usr/bin/env python3
"""
Complete CloudWatch setup: IAM permissions, dashboard, and alarms
"""

import boto3
import json
from pathlib import Path

class Colors:
    GREEN = '\033[92m'
    YELLOW = '\033[93m'
    RED = '\033[91m'
    BLUE = '\033[94m'
    NC = '\033[0m'

def print_step(message):
    print(f"\n{Colors.BLUE}=== {message} ==={Colors.NC}\n")

def print_success(message):
    print(f"{Colors.GREEN}[OK] {message}{Colors.NC}")

def print_error(message):
    print(f"{Colors.RED}[ERROR] {message}{Colors.NC}")

def print_warning(message):
    print(f"{Colors.YELLOW}[WARN] {message}{Colors.NC}")

def update_iam_permissions():
    """Add CloudWatch PutMetricData permissions to IAM role"""
    print_step("Step 1: Updating IAM Role Permissions")

    iam = boto3.client('iam')
    role_name = "eks-langfuse-backoffice-dev-langfuse-metrics-service"
    policy_name = "CloudWatchMetricsPolicy"

    policy_document = {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Effect": "Allow",
                "Action": ["cloudwatch:PutMetricData"],
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

    try:
        # Check if role exists
        iam.get_role(RoleName=role_name)
        print(f"  Found IAM role: {role_name}")

        # Put inline policy
        iam.put_role_policy(
            RoleName=role_name,
            PolicyName=policy_name,
            PolicyDocument=json.dumps(policy_document)
        )
        print_success(f"CloudWatch policy added: {policy_name}")

        # Verify
        policy = iam.get_role_policy(RoleName=role_name, PolicyName=policy_name)
        print_success("Policy verified successfully")

        return True
    except iam.exceptions.NoSuchEntityException:
        print_error(f"IAM role not found: {role_name}")
        return False
    except Exception as e:
        print_error(f"Failed to update IAM: {e}")
        return False

def create_dashboard():
    """Create CloudWatch dashboard"""
    print_step("Step 2: Creating CloudWatch Dashboard")

    cloudwatch = boto3.client('cloudwatch', region_name='eu-west-2')
    dashboard_name = "LangfuseMetricsService-dev"

    # Read dashboard JSON
    dashboard_path = Path("infra/cloudwatch-dashboard.json")
    if not dashboard_path.exists():
        print_error(f"Dashboard file not found: {dashboard_path}")
        return False

    with open(dashboard_path, 'r') as f:
        dashboard_body = json.load(f)

    try:
        cloudwatch.put_dashboard(
            DashboardName=dashboard_name,
            DashboardBody=json.dumps(dashboard_body)
        )
        print_success(f"Dashboard created: {dashboard_name}")
        print(f"  View at: https://eu-west-2.console.aws.amazon.com/cloudwatch/home?region=eu-west-2#dashboards:name={dashboard_name}")
        return True
    except Exception as e:
        print_error(f"Failed to create dashboard: {e}")
        return False

def create_alarms():
    """Create CloudWatch alarms"""
    print_step("Step 3: Creating CloudWatch Alarms")

    cloudwatch = boto3.client('cloudwatch', region_name='eu-west-2')
    namespace = "LangfuseMetricsService/dev"
    alarm_prefix = "LangfuseMetricsService-dev"

    alarms = [
        {
            "name": f"{alarm_prefix}-HighErrorRate",
            "description": "Alert when error rate exceeds 10%",
            "metric": "ErrorRate",
            "statistic": "Average",
            "threshold": 10,
            "comparison": "GreaterThanThreshold",
        },
        {
            "name": f"{alarm_prefix}-LowSuccessRate",
            "description": "Alert when success rate drops below 20%",
            "metric": "SuccessRate",
            "statistic": "Average",
            "threshold": 20,
            "comparison": "LessThanThreshold",
        },
        {
            "name": f"{alarm_prefix}-StaleGroundTruth",
            "description": "Alert when ground truth cache is older than 1 hour",
            "metric": "GroundTruthCacheAgeSeconds",
            "statistic": "Maximum",
            "threshold": 3600,
            "comparison": "GreaterThanThreshold",
        },
        {
            "name": f"{alarm_prefix}-HighLatency",
            "description": "Alert when batch processing takes > 10 seconds",
            "metric": "BatchProcessingDuration",
            "statistic": "Average",
            "threshold": 10000,
            "comparison": "GreaterThanThreshold",
        },
    ]

    created_count = 0
    for alarm_config in alarms:
        try:
            cloudwatch.put_metric_alarm(
                AlarmName=alarm_config["name"],
                AlarmDescription=alarm_config["description"],
                MetricName=alarm_config["metric"],
                Namespace=namespace,
                Statistic=alarm_config["statistic"],
                Period=300,
                EvaluationPeriods=2,
                Threshold=alarm_config["threshold"],
                ComparisonOperator=alarm_config["comparison"],
                TreatMissingData="notBreaching"
            )
            print_success(f"Alarm created: {alarm_config['name']}")
            created_count += 1
        except Exception as e:
            print_error(f"Failed to create alarm {alarm_config['name']}: {e}")

    print(f"\n  Created {created_count}/{len(alarms)} alarms")
    print(f"  View at: https://eu-west-2.console.aws.amazon.com/cloudwatch/home?region=eu-west-2#alarmsV2:")

    return created_count == len(alarms)

def main():
    print_step("CloudWatch Setup for Langfuse Metrics Service")

    print("This script will:")
    print("  1. Add CloudWatch permissions to IAM role")
    print("  2. Create CloudWatch dashboard")
    print("  3. Create CloudWatch alarms")
    print()

    # Step 1: IAM permissions
    iam_success = update_iam_permissions()
    if not iam_success:
        print_warning("IAM update failed, but continuing with CloudWatch resources...")

    # Step 2: Dashboard
    dashboard_success = create_dashboard()

    # Step 3: Alarms
    alarms_success = create_alarms()

    # Summary
    print_step("Setup Complete")

    if iam_success:
        print_success("IAM permissions updated")
    else:
        print_warning("IAM permissions NOT updated (may need manual intervention)")

    if dashboard_success:
        print_success("CloudWatch dashboard created")
    else:
        print_error("CloudWatch dashboard creation failed")

    if alarms_success:
        print_success("CloudWatch alarms created")
    else:
        print_warning("Some CloudWatch alarms failed to create")

    print("\nNext step: Deploy the service with CloudWatch integration")
    print("  cd c:/Users/Usuario/Desktop/SegurNeo/tirea-ai-metrics-service")
    print("  python deploy.py")

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print_error(f"Setup failed: {e}")
        import traceback
        traceback.print_exc()
