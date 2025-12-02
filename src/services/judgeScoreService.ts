import { createLogger } from '../utils/logger';

const logger = createLogger('JudgeScoreService');

export interface TraceScore {
  name: string;
  value: number;
  source: string;
  comment?: string;
}

export interface TraceWithScores {
  id: string;
  name: string;
  metadata: Record<string, any>;
  sessionId?: string;
  scores: TraceScore[];
  timestamp: Date;
}

/**
 * Judge score names from LLM evaluators (EVAL source)
 */
export const JUDGE_SCORE_NAMES = [
  'Extraction Accuracy',
  'Medical Extraction Quality',
  'Hallucination Detection',
  'Field Comparison',
  'judge-diagnosticos_accuracy',
  'judge-cie10_accuracy',
  'judge-destino_accuracy',
  'judge-completeness',
  'judge-overall_quality',
];

/**
 * Metrics score names we calculate and push (API source)
 */
export const METRICS_SCORE_NAMES = [
  'diagnostico_exact_f1',
  'diagnostico_soft_f1',
  'cie10_exact_accuracy',
  'cie10_prefix_accuracy',
  'destino_accuracy',
  'consultas_f1',
  'overall_average',
];

/**
 * Mapping from judge scores to metric scores
 * Judge scores are evaluated by LLM judges (EVAL source)
 * Metric scores are what the dashboard expects (API source)
 */
export const JUDGE_TO_METRIC_MAP: Record<string, string> = {
  // Document extraction quality judge scores
  'judge-diagnosticos_accuracy': 'diagnostico_soft_f1',
  'judge-cie10_accuracy': 'cie10_prefix_accuracy',
  'judge-destino_accuracy': 'destino_accuracy',
  'judge-overall_quality': 'overall_average',
  // Legacy judge scores
  'Extraction Accuracy': 'overall_average',
  'Medical Extraction Quality': 'diagnostico_soft_f1',
};

/**
 * Service to fetch and process judge scores from Langfuse
 */
export class JudgeScoreService {
  private baseUrl: string;
  private retryAttempts: number;
  private retryDelay: number;

  constructor() {
    this.baseUrl = process.env.LANGFUSE_URL || 'http://langfuse-web:3000';
    this.retryAttempts = parseInt(process.env.RETRY_ATTEMPTS || '3', 10);
    this.retryDelay = parseInt(process.env.RETRY_DELAY || '1000', 10);

    logger.info('JudgeScoreService initialized', { baseUrl: this.baseUrl });
  }

  /**
   * Get traces that have judge scores but not metric scores
   */
  async getTracesWithJudgeScoresOnly(limit: number = 100): Promise<TraceWithScores[]> {
    try {
      logger.debug('Fetching traces with judge scores');

      const response = await this.fetchWithRetry(
        `${this.baseUrl}/api/public/traces?page=1&limit=${limit}`,
        {
          method: 'GET',
          headers: this.getAuthHeaders(),
        }
      );

      const data = await response.json() as { data?: any[] };
      const traces = data.data || [];

      // Filter traces that have judge scores but not our metric scores
      const tracesNeedingMetrics: TraceWithScores[] = [];

      for (const trace of traces) {
        const scores = await this.getTraceScores(trace.id);

        const hasJudgeScores = scores.some(s =>
          s.source === 'EVAL' || JUDGE_SCORE_NAMES.includes(s.name)
        );

        const hasMetricScores = scores.some(s =>
          s.source === 'API' && METRICS_SCORE_NAMES.includes(s.name)
        );

        if (hasJudgeScores && !hasMetricScores) {
          tracesNeedingMetrics.push({
            id: trace.id,
            name: trace.name,
            metadata: trace.metadata || {},
            sessionId: trace.sessionId,
            scores,
            timestamp: new Date(trace.timestamp),
          });
        }
      }

      logger.info(`Found ${tracesNeedingMetrics.length} traces with judge scores needing metrics`);
      return tracesNeedingMetrics;
    } catch (error) {
      logger.error('Failed to get traces with judge scores', { error });
      throw error;
    }
  }

  /**
   * Get all scores for a specific trace
   */
  async getTraceScores(traceId: string): Promise<TraceScore[]> {
    try {
      const response = await this.fetchWithRetry(
        `${this.baseUrl}/api/public/v2/scores?traceId=${traceId}`,
        {
          method: 'GET',
          headers: this.getAuthHeaders(),
        }
      );

      const data = await response.json() as { data?: any[] };
      const scores = (data.data || []).map((s: any) => ({
        name: s.name,
        value: s.value,
        source: s.source,
        comment: s.comment,
      }));

      return scores;
    } catch (error) {
      logger.error(`Failed to get scores for trace ${traceId}`, { error });
      return [];
    }
  }

  /**
   * Convert judge scores to metric scores using the mapping
   */
  convertJudgeScoresToMetrics(judgeScores: TraceScore[]): Record<string, number> {
    const metrics: Record<string, number> = {};

    for (const score of judgeScores) {
      const metricName = JUDGE_TO_METRIC_MAP[score.name];
      if (metricName) {
        // If we already have a value for this metric, take the average
        if (metrics[metricName] !== undefined) {
          metrics[metricName] = (metrics[metricName] + score.value) / 2;
        } else {
          metrics[metricName] = score.value;
        }
      }
    }

    // Calculate overall_average if we have enough component metrics
    const componentMetrics = ['diagnostico_soft_f1', 'cie10_prefix_accuracy', 'destino_accuracy', 'consultas_f1'];
    const availableComponents = componentMetrics.filter(m => metrics[m] !== undefined);

    if (availableComponents.length > 0 && metrics['overall_average'] === undefined) {
      const sum = availableComponents.reduce((acc, m) => acc + metrics[m], 0);
      metrics['overall_average'] = sum / availableComponents.length;
    }

    return metrics;
  }

  /**
   * Fetch with retry logic
   */
  private async fetchWithRetry(url: string, options: RequestInit, attempt: number = 1): Promise<Response> {
    try {
      const response = await fetch(url, options);

      if (!response.ok && attempt < this.retryAttempts) {
        logger.warn(`Request failed (attempt ${attempt}/${this.retryAttempts}), retrying...`, {
          status: response.status,
          url,
        });

        await this.sleep(this.retryDelay * attempt);
        return this.fetchWithRetry(url, options, attempt + 1);
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return response;
    } catch (error) {
      if (attempt < this.retryAttempts) {
        logger.warn(`Request error (attempt ${attempt}/${this.retryAttempts}), retrying...`, { error });
        await this.sleep(this.retryDelay * attempt);
        return this.fetchWithRetry(url, options, attempt + 1);
      }
      throw error;
    }
  }

  /**
   * Get authentication headers
   */
  private getAuthHeaders(): Record<string, string> {
    const publicKey = process.env.LANGFUSE_PUBLIC_KEY!;
    const secretKey = process.env.LANGFUSE_SECRET_KEY!;
    const credentials = Buffer.from(`${publicKey}:${secretKey}`).toString('base64');

    return {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
