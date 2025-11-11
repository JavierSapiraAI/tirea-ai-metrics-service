import { createApp } from './app';
import { TraceProcessor } from './services/traceProcessor';
import { createLogger } from './utils/logger';

const logger = createLogger('Main');

// Validate environment variables
function validateEnv(): void {
  const required = [
    'LANGFUSE_URL',
    'LANGFUSE_PUBLIC_KEY',
    'LANGFUSE_SECRET_KEY',
    'GROUND_TRUTH_BUCKET',
    'AWS_REGION',
  ];

  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    logger.error('Missing required environment variables', { missing });
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  logger.info('Environment validation passed');
}

// Main function
async function main() {
  try {
    logger.info('=== Starting Metrics Service ===');

    // Validate environment
    validateEnv();

    // Create trace processor
    const traceProcessor = new TraceProcessor();

    // Create Express app
    const app = createApp(traceProcessor);
    const port = parseInt(process.env.PORT || '3001', 10);

    // Start HTTP server
    const server = app.listen(port, () => {
      logger.info(`HTTP server listening on port ${port}`);
    });

    // Start trace processor
    await traceProcessor.start();

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      logger.info(`Received ${signal}, starting graceful shutdown...`);

      // Stop accepting new connections
      server.close(() => {
        logger.info('HTTP server closed');
      });

      // Stop trace processor
      await traceProcessor.stop();

      logger.info('Graceful shutdown completed');
      process.exit(0);
    };

    // Register shutdown handlers
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    // Handle uncaught errors
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught exception', { error });
      shutdown('uncaughtException');
    });

    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled rejection', { reason, promise });
      shutdown('unhandledRejection');
    });

    logger.info('=== Metrics Service Started Successfully ===');
  } catch (error) {
    logger.error('Failed to start metrics service', { error });
    process.exit(1);
  }
}

// Start the service
main();
