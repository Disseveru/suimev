import { searcher } from './engine/searcher.js';
import { terminalDashboard } from './ui/terminal.js';
import { logger } from './ui/logger.js';

async function bootstrap() {
  try {
    console.clear();
    logger.info('Bootstrapping suimev-liquidator...');
    await searcher.start();
    terminalDashboard.start(4000);
    terminalDashboard.render();

    // Graceful shutdown handling
    const shutdown = () => {
      logger.info('Shutting down searcher gracefully...');
      terminalDashboard.stop();
      searcher.stop();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (err) {
    logger.error({ error: err }, 'Fatal error during engine startup');
    process.exit(1);
  }
}

bootstrap();
