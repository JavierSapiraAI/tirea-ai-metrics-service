import express, { Request, Response } from 'express';
import { TraceProcessor } from './services/traceProcessor';
import { MetricsCalculator, AIExtraction } from './services/metricsCalculator';
import { GroundTruthService, GroundTruthDocument } from './services/groundTruthService';
import { createLogger } from './utils/logger';

const logger = createLogger('App');

export function createApp(traceProcessor: TraceProcessor) {
  const app = express();

  // Initialize services for synchronous calculation endpoint
  const metricsCalculator = new MetricsCalculator();
  const groundTruthService = new GroundTruthService();

  // Middleware
  app.use(express.json());

  // Health check endpoint
  app.get('/health', (_req: Request, res: Response) => {
    const stats = traceProcessor.getStats();
    const cacheStats = stats.cacheStats;

    const health = {
      status: stats.isRunning ? 'healthy' : 'stopped',
      timestamp: new Date().toISOString(),
      service: 'metrics-service',
      version: '1.0.0',
      processor: {
        isRunning: stats.isRunning,
        pollInterval: stats.pollInterval,
        maxTracesPerPoll: stats.maxTracesPerPoll,
      },
      cache: {
        size: cacheStats.size,
        lastUpdated: cacheStats.lastUpdated,
        version: cacheStats.version,
        ageMs: cacheStats.ageMs,
      },
    };

    const statusCode = stats.isRunning ? 200 : 503;
    res.status(statusCode).json(health);
  });

  // Readiness probe endpoint
  app.get('/ready', (_req: Request, res: Response) => {
    const stats = traceProcessor.getStats();
    const cacheStats = stats.cacheStats;

    // Service is ready if processor is running
    // Cache can be empty if no ground truth data is available
    const isReady = stats.isRunning;

    const readiness = {
      ready: isReady,
      timestamp: new Date().toISOString(),
      checks: {
        processorRunning: stats.isRunning,
        cacheLoaded: cacheStats.size > 0,
        cacheSize: cacheStats.size,
      },
    };

    const statusCode = isReady ? 200 : 503;
    res.status(statusCode).json(readiness);
  });

  // Liveness probe endpoint
  app.get('/live', (_req: Request, res: Response) => {
    res.status(200).json({
      alive: true,
      timestamp: new Date().toISOString(),
    });
  });

  // Stats endpoint
  app.get('/stats', (_req: Request, res: Response) => {
    const stats = traceProcessor.getStats();
    res.json(stats);
  });

  /**
   * POST /calculate - Synchronous metrics calculation
   *
   * Used by Tirea-AI for on-demand quality score calculation.
   * Returns F1/Accuracy scores compared against ground truth.
   */
  app.post('/calculate', async (req: Request, res: Response) => {
    try {
      const { document_id, extraction, ground_truth } = req.body;

      // Validate input
      if (!document_id) {
        res.status(400).json({ error: 'document_id is required' });
        return;
      }

      if (!extraction) {
        res.status(400).json({ error: 'extraction is required' });
        return;
      }

      // Transform extraction to AIExtraction format if needed
      let aiExtraction: AIExtraction;
      if (extraction.diagnosticos) {
        // Tirea format - transform
        aiExtraction = metricsCalculator.extractDataFromTrace(extraction) || {
          document_id,
          diagnostico: [],
          cie10: [],
          destino_alta: '',
          consultas: []
        };
        aiExtraction.document_id = document_id;
      } else {
        // Already in correct format
        aiExtraction = extraction as AIExtraction;
      }

      // Get ground truth: use provided or look up from S3
      let gt: GroundTruthDocument | null = ground_truth as GroundTruthDocument | null;

      if (!gt) {
        gt = await groundTruthService.getGroundTruth(document_id);
      }

      if (!gt) {
        logger.info(`No ground truth found for document: ${document_id}`);
        res.status(404).json({
          error: 'Ground truth not found',
          document_id
        });
        return;
      }

      // Calculate metrics
      const metrics = metricsCalculator.calculateMetrics(aiExtraction, gt);

      // Return in CAS-HealthExtract compatible format
      res.json({
        document_id,
        scores: {
          diagnosticos_score: [metrics.diagnostico_soft_f1],
          destino_alta_score: metrics.destino_accuracy,
          consultas_pruebas_pendientes_score: [metrics.consultas_f1],
          cie10_accuracy: metrics.cie10_prefix_accuracy,
          overall: metrics.overall_average
        },
        raw_metrics: metrics,
        calculated_at: new Date().toISOString()
      });

    } catch (error: any) {
      logger.error('Failed to calculate metrics', { error: error.message });
      res.status(500).json({
        error: 'Failed to calculate metrics',
        message: error.message
      });
    }
  });

  // 404 handler
  app.use((req: Request, res: Response) => {
    res.status(404).json({
      error: 'Not Found',
      path: req.path,
    });
  });

  // Error handler
  app.use((err: Error, _req: Request, res: Response, _next: any) => {
    logger.error('Unhandled error', { error: err });
    res.status(500).json({
      error: 'Internal Server Error',
      message: err.message,
    });
  });

  return app;
}
