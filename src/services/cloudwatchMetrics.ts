import { CloudWatchClient, PutMetricDataCommand, MetricDatum, StandardUnit } from '@aws-sdk/client-cloudwatch';
import { logger } from '../utils/logger';

export interface ProcessingMetrics {
  total: number;
  success: number;
  skipped: number;
  errors: number;
  durationMs: number;
  groundTruthDocuments?: number;
  groundTruthCacheAge?: number;
}

export class CloudWatchMetricsService {
  private client: CloudWatchClient;
  private namespace: string;
  private environment: string;
  private enabled: boolean;

  constructor() {
    this.environment = process.env.ENVIRONMENT || 'dev';
    this.namespace = `LangfuseMetricsService/${this.environment}`;
    this.enabled = process.env.CLOUDWATCH_METRICS_ENABLED !== 'false';

    this.client = new CloudWatchClient({
      region: process.env.AWS_REGION || 'eu-west-2',
    });

    logger.info('CloudWatch metrics service initialized', {
      namespace: this.namespace,
      environment: this.environment,
      enabled: this.enabled,
    });
  }

  /**
   * Publish batch processing metrics
   */
  async publishBatchMetrics(metrics: ProcessingMetrics): Promise<void> {
    if (!this.enabled) {
      logger.debug('CloudWatch metrics disabled, skipping publish');
      return;
    }

    try {
      const timestamp = new Date();
      const metricData: MetricDatum[] = [
        // Processing counts
        {
          MetricName: 'ProcessingTotal',
          Value: metrics.total,
          Unit: StandardUnit.Count,
          Timestamp: timestamp,
        },
        {
          MetricName: 'ProcessingSuccess',
          Value: metrics.success,
          Unit: StandardUnit.Count,
          Timestamp: timestamp,
        },
        {
          MetricName: 'ProcessingSkipped',
          Value: metrics.skipped,
          Unit: StandardUnit.Count,
          Timestamp: timestamp,
        },
        {
          MetricName: 'ProcessingErrors',
          Value: metrics.errors,
          Unit: StandardUnit.Count,
          Timestamp: timestamp,
        },

        // Rates (percentages)
        {
          MetricName: 'SuccessRate',
          Value: metrics.total > 0 ? (metrics.success / metrics.total) * 100 : 0,
          Unit: StandardUnit.Percent,
          Timestamp: timestamp,
        },
        {
          MetricName: 'ErrorRate',
          Value: metrics.total > 0 ? (metrics.errors / metrics.total) * 100 : 0,
          Unit: StandardUnit.Percent,
          Timestamp: timestamp,
        },
        {
          MetricName: 'SkipRate',
          Value: metrics.total > 0 ? (metrics.skipped / metrics.total) * 100 : 0,
          Unit: StandardUnit.Percent,
          Timestamp: timestamp,
        },

        // Latency
        {
          MetricName: 'BatchProcessingDuration',
          Value: metrics.durationMs,
          Unit: StandardUnit.Milliseconds,
          Timestamp: timestamp,
        },
        {
          MetricName: 'AverageProcessingTimePerTrace',
          Value: metrics.total > 0 ? metrics.durationMs / metrics.total : 0,
          Unit: StandardUnit.Milliseconds,
          Timestamp: timestamp,
        },
      ];

      // Optional metrics
      if (metrics.groundTruthDocuments !== undefined) {
        metricData.push({
          MetricName: 'GroundTruthDocuments',
          Value: metrics.groundTruthDocuments,
          Unit: StandardUnit.Count,
          Timestamp: timestamp,
        });
      }

      if (metrics.groundTruthCacheAge !== undefined) {
        metricData.push({
          MetricName: 'GroundTruthCacheAgeSeconds',
          Value: metrics.groundTruthCacheAge,
          Unit: StandardUnit.Seconds,
          Timestamp: timestamp,
        });
      }

      const command = new PutMetricDataCommand({
        Namespace: this.namespace,
        MetricData: metricData,
      });

      await this.client.send(command);
      logger.debug('CloudWatch metrics published successfully', {
        metricsCount: metricData.length,
        successRate: metricData.find(m => m.MetricName === 'SuccessRate')?.Value,
        errorRate: metricData.find(m => m.MetricName === 'ErrorRate')?.Value,
      });
    } catch (error) {
      // Don't throw - metrics publishing should never break the main flow
      logger.error('Failed to publish CloudWatch metrics', { error });
    }
  }

  /**
   * Publish a single custom metric
   */
  async publishMetric(
    name: string,
    value: number,
    unit: StandardUnit = StandardUnit.None,
    dimensions?: Record<string, string>
  ): Promise<void> {
    if (!this.enabled) {
      return;
    }

    try {
      const metricData: MetricDatum = {
        MetricName: name,
        Value: value,
        Unit: unit,
        Timestamp: new Date(),
      };

      if (dimensions) {
        metricData.Dimensions = Object.entries(dimensions).map(([name, value]) => ({
          Name: name,
          Value: value,
        }));
      }

      const command = new PutMetricDataCommand({
        Namespace: this.namespace,
        MetricData: [metricData],
      });

      await this.client.send(command);
      logger.debug(`Published metric: ${name} = ${value} ${unit}`);
    } catch (error) {
      logger.error(`Failed to publish metric ${name}`, { error });
    }
  }
}
