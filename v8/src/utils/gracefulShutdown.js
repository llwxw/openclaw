function setupGracefulShutdown(server, scheduler, taskStore, logger) {
  let shuttingDown = false;

  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Starting graceful shutdown...');

    server.close(async () => {
      logger.info('HTTP server closed');
    });

    await scheduler.stop();
    await taskStore.close();

    logger.info('Shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

module.exports = { setupGracefulShutdown };
