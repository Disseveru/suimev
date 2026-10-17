import { searcher } from './engine/searcher.js';
import { terminalDashboard } from './ui/terminal.js';
import { telemetryBridge } from './engine/telemetryBridge.js';
import { logger } from './ui/logger.js';
import { suiClient } from './client/suiClient.js';
import { validateSharedVersions } from './config/constants.js';

async function bootstrap() {
  try {
    console.clear();
    logger.info('Bootstrapping suimev-liquidator...');
    await validateSharedVersions(suiClient);
    await searcher.start();
    telemetryBridge.start(1000);
    terminalDashboard.start(4000);
    terminalDashboard.render();

    // Graceful shutdown handling
    const shutdown = () => {
      logger.info('Shutting down searcher gracefully...');
      terminalDashboard.stop();
      telemetryBridge.stop();
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
