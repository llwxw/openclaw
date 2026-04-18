const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { scoreTask } = require('../scoring/scoring');

function createApiRouter(taskStore, scheduler, healthChecker, security, metrics, config) {
  const router = express.Router();

  // 限流中间件
  router.use('/task', (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress;
    if (!security.checkRateLimit(ip)) {
      return res.status(429).json({ error: 'Rate limit exceeded', retryAfter: 1 });
    }
    next();
  });

  // POST /api/score
  router.post('/score', async (req, res) => {
    try {
      const { prompt, text, context } = req.body;
      const promptText = prompt || text;  // 兼容 text 字段（gateway hook 用的是 text）
      if (!promptText) {
        return res.status(400).json({ error: 'prompt or text field required' });
      }
      const result = await scoreTask(promptText, context);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/task
  router.post('/task', async (req, res) => {
    try {
      const { id, command, args, cwd, env, timeout, priority, metadata, type, skillName, skillParams } = req.body;

      // 技能任务不需要 command
      if (type === 'skill' && skillName) {
        const task = {
          id: id || uuidv4(),
          type,
          skillName,
          skillParams: skillParams || {},
          command: 'internal-skill',
          args: [],
          timeout: timeout || 7200,
          priority: priority || 0,
          metadata
        };
        const result = await taskStore.enqueue(task);
        metrics.inc('tasks_submitted');
        return res.status(202).json({
          id: result.id,
          status: 'pending',
          created_at: Date.now()
        });
      }

      if (!command) {
        return res.status(400).json({ error: 'command is required' });
      }

      const task = {
        id: id || uuidv4(),
        command,
        args: args || [],
        cwd,
        env,
        timeout: timeout || 300,
        priority: priority || 0,
        metadata
      };

      const result = await taskStore.enqueue(task);
      metrics.inc('tasks_submitted');

      res.status(202).json({
        id: result.id,
        status: 'pending',
        created_at: Date.now()
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/task/:id
  router.get('/task/:id', async (req, res) => {
    try {
      const task = await taskStore.getTask(req.params.id);
      if (!task) {
        return res.status(404).json({ error: 'Task not found' });
      }

      const payload = JSON.parse(task.payload);
      res.json({
        id: task.id,
        status: task.status,
        progress: task.progress,
        created_at: task.created_at,
        updated_at: task.updated_at,
        command: payload.command,
        error_message: task.error_message
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/context/status
  router.get('/context/status', (req, res) => {
    res.json({
      maxTokens: config.context.maxContextTokens,
      currentTokens: 0,
      threshold: config.context.summarizeThreshold
    });
  });

  // GET /health
  router.get('/health', async (req, res) => {
    const health = await healthChecker.check();
    const statusCode = health.status === 'healthy' ? 200 : (health.status === 'down' ? 503 : 200);
    res.status(statusCode).json(health);
  });

  // GET /metrics
  router.get('/metrics', (req, res) => {
    res.json(metrics.getMetrics());
  });

  return router;
}

module.exports = { createApiRouter };
