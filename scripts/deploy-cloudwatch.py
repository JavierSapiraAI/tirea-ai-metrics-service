#!/usr/bin/env python3
"""
Deploy CloudWatch Dashboard and Alarms for Langfuse Metrics Service
"""

import json
import subprocess
import sys
from pathlib import Path

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
    print_step("Deploying CloudWatch Dashboard and Alarms")

    # Configuration
    environment = "dev"
    region = "eu-west-2"
    dashboard_name = f"LangfuseMetricsService-{environment}"
    namespace = f"LangfuseMetricsService/{environment}"

    # Get AWS account info
    print_step("Step 1: Getting AWS account information")
    account_id = run_command(
        "aws sts get-caller-identity --query Account --output text",
        "Getting AWS account ID..."
    )
    print(f"  AWS Account: {account_id}")
    print_success("AWS credentials verified")

    # Read dashboard JSON
    print_step("Step 2: Preparing CloudWatch dashboard")
    dashboard_path = Path("infra/cloudwatch-dashboard.json")
    if not dashboard_path.exists():
        print(f"{Colors.RED}[ERROR] Dashboard file not found: {dashboard_path}{Colors.NC}")
        sys.exit(1)

    with open(dashboard_path, 'r') as f:
        dashboard_body = json.load(f)

    # Escape the dashboard body for AWS CLI
    dashboard_json = json.dumps(dashboard_body)

    # Deploy dashboard
    run_command(
        f'aws cloudwatch put-dashboard --dashboard-name "{dashboard_name}" --dashboard-body \'{dashboard_json}\' --region {region}',
        f"Deploying dashboard '{dashboard_name}'..."
    )
    print_success(f"Dashboard deployed: {dashboard_name}")

    # Create alarms
    print_step("Step 3: Creating CloudWatch alarms")

    # Alarm 1: High Error Rate (> 10%)
    run_command(
        f'''aws cloudwatch put-metric-alarm \
            --alarm-name "{dashboard_name}-HighErrorRate" \
            --alarm-description "Alert when error rate exceeds 10%" \
            --metric-name ErrorRate \
            --namespace "{namespace}" \
            --statistic Average \
            --period 300 \
            --evaluation-periods 2 \
            --threshold 10 \
            --comparison-operator GreaterThanThreshold \
            --treat-missing-data notBreaching \
            --region {region}''',
        "Creating High Error Rate alarm (> 10%)..."
    )
    print_success("High Error Rate alarm created")

    # Alarm 2: Processing Rate Drop (success rate < 20%)
    run_command(
        f'''aws cloudwatch put-metric-alarm \
            --alarm-name "{dashboard_name}-LowSuccessRate" \
            --alarm-description "Alert when success rate drops below 20%" \
            --metric-name SuccessRate \
            --namespace "{namespace}" \
            --statistic Average \
            --period 300 \
            --evaluation-periods 3 \
            --threshold 20 \
            --comparison-operator LessThanThreshold \
            --treat-missing-data notBreaching \
            --region {region}''',
        "Creating Low Success Rate alarm (< 20%)..."
    )
    print_success("Low Success Rate alarm created")

    # Alarm 3: Stale Ground Truth Cache (> 1 hour = 3600 seconds)
    run_command(
        f'''aws cloudwatch put-metric-alarm \
            --alarm-name "{dashboard_name}-StaleGroundTruth" \
            --alarm-description "Alert when ground truth cache is older than 1 hour" \
            --metric-name GroundTruthCacheAgeSeconds \
            --namespace "{namespace}" \
            --statistic Maximum \
            --period 300 \
            --evaluation-periods 2 \
            --threshold 3600 \
            --comparison-operator GreaterThanThreshold \
            --treat-missing-data notBreaching \
            --region {region}''',
        "Creating Stale Ground Truth alarm (> 1 hour)..."
    )
    print_success("Stale Ground Truth alarm created")

    # Alarm 4: High Processing Latency (> 10 seconds)
    run_command(
        f'''aws cloudwatch put-metric-alarm \
            --alarm-name "{dashboard_name}-HighLatency" \
            --alarm-description "Alert when batch processing takes > 10 seconds" \
            --metric-name BatchProcessingDuration \
            --namespace "{namespace}" \
            --statistic Average \
            --period 300 \
            --evaluation-periods 2 \
            --threshold 10000 \
            --comparison-operator GreaterThanThreshold \
            --treat-missing-data notBreaching \
            --region {region}''',
        "Creating High Latency alarm (> 10s)..."
    )
    print_success("High Latency alarm created")

    # Summary
    print_step("Deployment Complete")
    print(f"{Colors.GREEN}CloudWatch resources deployed successfully!{Colors.NC}\n")
    print("Dashboard:")
    print(f"  https://{region}.console.aws.amazon.com/cloudwatch/home?region={region}#dashboards:name={dashboard_name}")
    print("\nAlarms created:")
    print(f"  1. {dashboard_name}-HighErrorRate (threshold: > 10%)")
    print(f"  2. {dashboard_name}-LowSuccessRate (threshold: < 20%)")
    print(f"  3. {dashboard_name}-StaleGroundTruth (threshold: > 1 hour)")
    print(f"  4. {dashboard_name}-HighLatency (threshold: > 10 seconds)")
    print(f"\nView alarms:")
    print(f"  https://{region}.console.aws.amazon.com/cloudwatch/home?region={region}#alarmsV2:")

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"{Colors.RED}[ERROR] Deployment failed: {e}{Colors.NC}")
        sys.exit(1)
