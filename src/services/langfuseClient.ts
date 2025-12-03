import { Langfuse } from 'langfuse';
import { createLogger } from '../utils/logger';
import { MedicalMetrics } from './metricsCalculator';

const logger = createLogger('LangfuseClient');

export interface TraceData {
  id: string;
  name: string;
  metadata: Record<string, any>;
  output: any;
  input: any;
  timestamp: Date;
}

export class LangfuseClient {
  private client: Langfuse;
  private retryAttempts: number;
  private retryDelay: number;

  constructor() {
    const baseUrl = process.env.LANGFUSE_URL || 'http://langfuse-web:3000';
    const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
    const secretKey = process.env.LANGFUSE_SECRET_KEY;

    if (!publicKey || !secretKey) {
      throw new Error('LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY must be set');
    }

    this.client = new Langfuse({
      baseUrl,
      publicKey,
      secretKey,
      flushAt: 1, // Flush immediately
      flushInterval: 1000,
    });

    this.retryAttempts = parseInt(process.env.RETRY_ATTEMPTS || '3', 10);
    this.retryDelay = parseInt(process.env.RETRY_DELAY || '1000', 10);

    logger.info('Langfuse client initialized', { baseUrl });
  }

  /**
   * Query traces that don't have medical scores yet
   */
  async getUnprocessedTraces(limit: number = 100): Promise<TraceData[]> {
    try {
      logger.debug(`Querying for unprocessed traces (limit: ${limit})`);

      // Note: This is a simplified implementation. The actual Langfuse SDK may have different APIs
      // We'll need to use the HTTP API directly if the SDK doesn't support filtering by scores

      const response = await this.fetchWithRetry(
        `${this.getBaseUrl()}/api/public/traces?page=1&limit=${limit}`,
        {
          method: 'GET',
          headers: this.getAuthHeaders(),
        }
      );

      const data = await response.json() as { data?: any[] };
      const traces = data.data || [];

      // Filter traces that don't have medical scores
      const unprocessedTraces = traces.filter((trace: any) => {
        const scores = trace.scores || [];
        const hasMedicalScores = scores.some((score: any) =>
          score.name === 'diagnostico_exact_f1' ||
          score.name === 'overall_average'
        );
        return !hasMedicalScores && trace.metadata?.document_id;
      });

      logger.info(`Found ${unprocessedTraces.length} unprocessed traces out of ${traces.length} total`);

      // Fetch full trace details with observations to get the actual output
      const tracesWithOutput = await Promise.all(
        unprocessedTraces.map(async (trace: any) => {
          try {
            const output = await this.getTraceOutput(trace.id);
            return {
              id: trace.id,
              name: trace.name,
              metadata: trace.metadata || {},
              output,
              input: trace.input,
              timestamp: new Date(trace.timestamp),
            };
          } catch (error) {
            logger.warn(`Failed to get output for trace ${trace.id}`, { error });
            return {
              id: trace.id,
              name: trace.name,
              metadata: trace.metadata || {},
              output: null,
              input: trace.input,
              timestamp: new Date(trace.timestamp),
            };
          }
        })
      );

      return tracesWithOutput;
    } catch (error) {
      logger.error('Failed to get unprocessed traces', { error });
      throw error;
    }
  }

  /**
   * Get trace output from observations
   * The actual AI output is in the GENERATION observation, not trace.output
   */
  private async getTraceOutput(traceId: string): Promise<any> {
    try {
      const response = await this.fetchWithRetry(
        `${this.getBaseUrl()}/api/public/traces/${traceId}`,
        {
          method: 'GET',
          headers: this.getAuthHeaders(),
        }
      );

      const trace = await response.json() as any;
      const observations = trace.observations || [];

      // Find the GENERATION observation with output
      const generationObs = observations.find((obs: any) =>
        obs.type === 'GENERATION' && obs.output
      );

      if (generationObs) {
        logger.debug(`Found generation output for trace ${traceId}`);
        return generationObs.output;
      }

      logger.debug(`No generation output found for trace ${traceId}`);
      return null;
    } catch (error) {
      logger.error(`Failed to get trace output for ${traceId}`, { error });
      return null;
    }
  }

  /**
   * Push medical metrics as scores to a trace
   */
  async pushMetrics(traceId: string, metrics: MedicalMetrics): Promise<void> {
    try {
      logger.debug(`Pushing metrics for trace: ${traceId}`);

      // Create a score for each metric
      const scorePromises = [
        // Ground truth comparison metrics (see docs/SCORE-NAMING-CONVENTION.md)
        // Diagnostico exact metrics
        this.createScore(traceId, 'groundtruth-diagnostico_exact_precision', metrics.diagnostico_exact_precision),
        this.createScore(traceId, 'groundtruth-diagnostico_exact_recall', metrics.diagnostico_exact_recall),
        this.createScore(traceId, 'groundtruth-diagnostico_exact_f1', metrics.diagnostico_exact_f1),

        // Diagnostico soft metrics
        this.createScore(traceId, 'groundtruth-diagnostico_soft_precision', metrics.diagnostico_soft_precision),
        this.createScore(traceId, 'groundtruth-diagnostico_soft_recall', metrics.diagnostico_soft_recall),
        this.createScore(traceId, 'groundtruth-diagnostico_soft_f1', metrics.diagnostico_soft_f1),

        // CIE-10 metrics
        this.createScore(traceId, 'groundtruth-cie10_exact_accuracy', metrics.cie10_exact_accuracy),
        this.createScore(traceId, 'groundtruth-cie10_prefix_accuracy', metrics.cie10_prefix_accuracy),

        // Destino metrics
        this.createScore(traceId, 'groundtruth-destino_accuracy', metrics.destino_accuracy),

        // Consultas metrics
        this.createScore(traceId, 'groundtruth-consultas_precision', metrics.consultas_precision),
        this.createScore(traceId, 'groundtruth-consultas_recall', metrics.consultas_recall),
        this.createScore(traceId, 'groundtruth-consultas_f1', metrics.consultas_f1),

        // Overall metrics
        this.createScore(traceId, 'groundtruth-overall_average', metrics.overall_average),
      ];

      await Promise.all(scorePromises);

      // Flush to ensure scores are sent
      await this.client.flushAsync();

      logger.info(`Metrics pushed successfully for trace: ${traceId}`, {
        overall: metrics.overall_average,
      });
    } catch (error) {
      logger.error(`Failed to push metrics for trace: ${traceId}`, { error });
      throw error;
    }
  }

  /**
   * Create a single score for a trace
   */
  private async createScore(traceId: string, name: string, value: number): Promise<void> {
    try {
      this.client.score({
        traceId,
        name,
        value,
        comment: 'Calculated by metrics-service',
      });

      logger.debug(`Score created: ${name} = ${value} for trace ${traceId}`);
    } catch (error) {
      logger.error(`Failed to create score ${name} for trace ${traceId}`, { error });
      throw error;
    }
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
   * Get base URL
   */
  private getBaseUrl(): string {
    return process.env.LANGFUSE_URL || 'http://langfuse-web:3000';
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Shutdown the client gracefully
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down Langfuse client...');
    await this.client.shutdownAsync();
    logger.info('Langfuse client shut down successfully');
  }
}
