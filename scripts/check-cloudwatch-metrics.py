#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Check if CloudWatch metrics are being received
"""

import boto3
from datetime import datetime, timedelta, timezone

def check_metrics():
    cloudwatch = boto3.client('cloudwatch', region_name='eu-west-2')
    namespace = "LangfuseMetricsService/dev"

    # Time range: last 15 minutes
    end_time = datetime.now(timezone.utc)
    start_time = end_time - timedelta(minutes=15)

    metrics_to_check = [
        'SuccessRate',
        'ErrorRate',
        'ProcessingTotal',
        'BatchProcessingDuration'
    ]

    print(f"\n=== Checking CloudWatch Metrics ===")
    print(f"Namespace: {namespace}")
    print(f"Time range: {start_time.strftime('%Y-%m-%d %H:%M:%S')} to {end_time.strftime('%Y-%m-%d %H:%M:%S')} UTC\n")

    all_metrics_present = True

    for metric_name in metrics_to_check:
        try:
            response = cloudwatch.get_metric_statistics(
                Namespace=namespace,
                MetricName=metric_name,
                StartTime=start_time,
                EndTime=end_time,
                Period=300,
                Statistics=['Average', 'Maximum', 'Minimum']
            )

            datapoints = response.get('Datapoints', [])

            if datapoints:
                # Sort by timestamp
                datapoints.sort(key=lambda x: x['Timestamp'])
                latest = datapoints[-1]

                print(f"[OK] {metric_name}:")
                print(f"   Latest value: {latest.get('Average', latest.get('Maximum', 'N/A')):.2f}")
                print(f"   Timestamp: {latest['Timestamp'].strftime('%Y-%m-%d %H:%M:%S')} UTC")
                print(f"   Data points: {len(datapoints)}")
            else:
                print(f"[MISSING] {metric_name}: NO DATA")
                all_metrics_present = False

        except Exception as e:
            print(f"[ERROR] {metric_name}: {e}")
            all_metrics_present = False

        print()

    if all_metrics_present:
        print("[SUCCESS] All metrics are being published to CloudWatch successfully!")
    else:
        print("[WARNING] Some metrics are missing. Check service logs for errors.")

if __name__ == "__main__":
    try:
        check_metrics()
    except Exception as e:
        print(f"Error checking CloudWatch metrics: {e}")
        import traceback
        traceback.print_exc()
