const express = require('express');
const { loadConfig } = require('./config');
const { TaskStore } = require('./persistence/TaskStore');
const { Scheduler } = require('./scheduler/Scheduler');
const { SandboxExecutor } = require('./executor/SandboxExecutor');
const { SecurityGateway } = require('./security/SecurityGateway');
const { createLogger } = require('./observability/logger');
const { HealthChecker } = require('./observability/health');
const { MetricsCollector } = require('./observability/metrics');
const { createApiRouter } = require('./router/api');
const { setupGracefulShutdown } = require('./utils/gracefulShutdown');

(async () => {
  // 1. 加载配置
  const config = loadConfig();
  const logger = createLogger(config);
  logger.info('OpenClaw v8.0 starting...');

  // 2. 初始化组件
  const taskStore = new TaskStore(config);
  await taskStore.init();
  taskStore.on('error', (err) => logger.error({ err }, 'TaskStore error'));
  taskStore.on('recovered', (count) => logger.info({ recovered: count }, 'Stale tasks recovered'));

  const security = new SecurityGateway(config);
  const executor = new SandboxExecutor(config, logger);
  const metrics = new MetricsCollector();
  const healthChecker = new HealthChecker(config, taskStore);

  const scheduler = new Scheduler(taskStore, executor, config, logger);
  scheduler.on('error', (err) => logger.error({ err }, 'Scheduler error'));
  scheduler.on('task:started', ({ taskId }) => logger.info({ taskId }, 'Task started'));
  scheduler.on('task:completed', ({ taskId }) => {
    metrics.inc('tasks_completed');
    logger.info({ taskId }, 'Task completed');
  });
  scheduler.on('task:failed', ({ taskId, error }) => {
    metrics.inc('tasks_failed');
    logger.warn({ taskId, error }, 'Task failed');
  });
  scheduler.on('draining', (count) => logger.info({ remaining: count }, 'Draining tasks'));

  // 3. 启动调度器（不阻塞）
  scheduler.start().catch(err => logger.fatal({ err }, 'Scheduler crashed'));

  // 4. 创建 Express 应用
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use((req, res, next) => {
    logger.debug({ method: req.method, url: req.url }, 'Request');
    next();
  });

  const apiRouter = createApiRouter(taskStore, scheduler, healthChecker, security, metrics, config);
  app.use('/api', apiRouter);

  // 5. 启动 HTTP 服务器
  const server = app.listen(config.server.port, config.server.host, () => {
    logger.info({ host: config.server.host, port: config.server.port }, 'OpenClaw v8.0 listening');
  });

  // 6. 优雅停机
  setupGracefulShutdown(server, scheduler, taskStore, logger);
})();
