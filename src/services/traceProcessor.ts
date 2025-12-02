import { GroundTruthService } from './groundTruthService';
import { MetricsCalculator } from './metricsCalculator';
import { LangfuseClient } from './langfuseClient';
import { createLogger } from '../utils/logger';

const logger = createLogger('TraceProcessor');

export class TraceProcessor {
  private groundTruthService: GroundTruthService;
  private metricsCalculator: MetricsCalculator;
  private langfuseClient: LangfuseClient;
  private pollInterval: number;
  private maxTracesPerPoll: number;
  private isRunning: boolean = false;
  private intervalId?: NodeJS.Timeout;

  constructor() {
    this.groundTruthService = new GroundTruthService();
    this.metricsCalculator = new MetricsCalculator();
    this.langfuseClient = new LangfuseClient();
    this.pollInterval = parseInt(process.env.POLL_INTERVAL || '60000', 10); // 60 seconds
    this.maxTracesPerPoll = parseInt(process.env.MAX_TRACES_PER_POLL || '100', 10);

    logger.info('TraceProcessor initialized', {
      pollInterval: this.pollInterval,
      maxTracesPerPoll: this.maxTracesPerPoll,
    });
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('TraceProcessor is already running');
      return;
    }

    this.isRunning = true;
    logger.info('Starting TraceProcessor...');

    try {
      await this.groundTruthService.refreshCache();
      logger.info('Ground truth cache loaded successfully');
    } catch (error) {
      logger.error('Failed to load initial ground truth cache', { error });
      throw error;
    }

    this.intervalId = setInterval(() => {
      this.processBatch().catch(error => {
        logger.error('Error in processing batch', { error });
      });
    }, this.pollInterval);

    await this.processBatch();
    logger.info('TraceProcessor started successfully');
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;

    logger.info('Stopping TraceProcessor...');
    this.isRunning = false;

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }

    await this.langfuseClient.shutdown();
    logger.info('TraceProcessor stopped successfully');
  }

  private async processBatch(): Promise<void> {
    try {
      const startTime = Date.now();
      logger.info('Starting batch processing...');

      const cacheStats = this.groundTruthService.getCacheStats();
      logger.debug('Ground truth cache stats', cacheStats);

      const traces = await this.langfuseClient.getUnprocessedTraces(this.maxTracesPerPoll);

      if (traces.length === 0) {
        logger.info('No unprocessed traces found');
        return;
      }

      logger.info(`Processing ${traces.length} traces...`);

      let successCount = 0;
      let skipCount = 0;
      let errorCount = 0;

      for (const trace of traces) {
        try {
          const processed = await this.processTrace(trace);
          if (processed) {
            successCount++;
          } else {
            skipCount++;
          }
        } catch (error) {
          errorCount++;
          logger.error(`Failed to process trace ${trace.id}`, { error });
        }
      }

      const duration = Date.now() - startTime;
      logger.info('Batch processing completed', {
        total: traces.length,
        success: successCount,
        skipped: skipCount,
        errors: errorCount,
        durationMs: duration,
      });
    } catch (error) {
      logger.error('Batch processing failed', { error });
    }
  }

  private async processTrace(trace: any): Promise<boolean> {
    try {
      const documentId = trace.metadata?.document_id;
      const filename = trace.metadata?.filename;

      if (!documentId && !filename) {
        logger.debug(`Trace ${trace.id} has no document_id or filename in metadata, skipping`);
        return false;
      }

      logger.debug(`Processing trace ${trace.id} for document ${documentId} / filename ${filename}`);

      let groundTruth = documentId
        ? await this.groundTruthService.getGroundTruth(documentId)
        : null;

      if (!groundTruth && filename) {
        logger.debug(`No ground truth found for document_id ${documentId}, trying filename ${filename}`);
        groundTruth = await this.groundTruthService.getGroundTruth(filename);

        if (!groundTruth) {
          const caseNumbers = this.extractCaseNumbersFromFilename(filename);
          for (const caseNum of caseNumbers) {
            logger.debug(`Trying case number pattern: ${caseNum}`);
            groundTruth = await this.groundTruthService.getGroundTruth(caseNum);
            if (groundTruth) {
              logger.debug(`Found ground truth using case number: ${caseNum}`);
              break;
            }
          }
        }
      }

      if (!groundTruth) {
        logger.debug(`No ground truth found for document ${documentId} or filename ${filename}, skipping`);
        return false;
      }

      const extraction = this.metricsCalculator.extractDataFromTrace(trace.output);

      if (!extraction) {
        logger.warn(`Failed to extract data from trace ${trace.id}, skipping`);
        return false;
      }

      if (!extraction.document_id) {
        extraction.document_id = documentId;
      }

      if (!this.metricsCalculator.validateData(extraction, groundTruth)) {
        logger.warn(`Data validation failed for trace ${trace.id}, skipping`);
        return false;
      }

      const metrics = this.metricsCalculator.calculateMetrics(extraction, groundTruth);
      await this.langfuseClient.pushMetrics(trace.id, metrics);

      logger.info(`Successfully processed trace ${trace.id}`, {
        documentId,
        overall: metrics.overall_average,
      });

      return true;
    } catch (error) {
      logger.error(`Error processing trace ${trace.id}`, { error });
      throw error;
    }
  }

  private extractCaseNumbersFromFilename(filename: string): string[] {
    const patterns: string[] = [];

    let baseName = filename
      .replace(/.pdf$/i, '')
      .replace(/__.*$/, '')
      .replace(/s*(dragged).*$/i, '')
      .replace(/s*copy.*$/i, '')
      .replace(/_/g, ' ')
      .trim()
      .replace(/s+/g, '-');

    const fullMatch = baseName.match(/^(d{12}-d{8,9}-d{3})/);
    if (fullMatch) {
      patterns.push(fullMatch[1]);
    }

    const firstNumMatch = baseName.match(/^(d{12})/);
    if (firstNumMatch) {
      patterns.push(firstNumMatch[1]);
    }

    if (baseName && !patterns.includes(baseName)) {
      patterns.push(baseName);
    }

    logger.debug('Extracted case number patterns from filename', { filename, patterns });
    return patterns;
  }

  getStats() {
    return {
      isRunning: this.isRunning,
      pollInterval: this.pollInterval,
      maxTracesPerPoll: this.maxTracesPerPoll,
      cacheStats: this.groundTruthService.getCacheStats(),
    };
  }
}

