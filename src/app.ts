import express, { Request, Response } from 'express';
import { TraceProcessor } from './services/traceProcessor';
import { createLogger } from './utils/logger';

const logger = createLogger('App');

export function createApp(traceProcessor: TraceProcessor) {
  const app = express();

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

    // Service is ready if processor is running and cache is loaded
    const isReady = stats.isRunning && cacheStats.size > 0;

    const readiness = {
      ready: isReady,
      timestamp: new Date().toISOString(),
      checks: {
        processorRunning: stats.isRunning,
        cacheLoaded: cacheStats.size > 0,
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
