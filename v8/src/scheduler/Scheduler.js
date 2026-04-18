const EventEmitter = require('events');
const { Mutex } = require('async-mutex');

class Scheduler extends EventEmitter {
  constructor(taskStore, executor, config, logger) {
    super();
    this.taskStore = taskStore;
    this.executor = executor;
    this.config = config;
    this.logger = logger;

    this.pollInterval = config.scheduler.pollIntervalMin;
    this.pollIntervalMin = config.scheduler.pollIntervalMin;
    this.pollIntervalMax = config.scheduler.pollIntervalMax;
    this.staleRecoveryInterval = config.scheduler.staleRecoveryIntervalSec * 1000;
    this.maxConcurrent = config.scheduler.maxConcurrentTasks;

    this.running = false;
    this.activeTasks = new Set();
    this.lastCleanup = Date.now();
    this.mutex = new Mutex();
  }

  async start() {
    this.running = true;
    this.emit('started');
    this.logger.info('Scheduler started');

    while (this.running) {
      try {
        // 并发控制
        if (this.activeTasks.size >= this.maxConcurrent) {
          await this._sleep(100);
          continue;
        }

        // 定期清理过期租约
        if (Date.now() - this.lastCleanup > this.staleRecoveryInterval) {
          const recovered = await this.taskStore.recoverStaleTasks();
          if (recovered > 0) {
            this.emit('recovered', recovered);
            this.logger.info({ recovered }, 'Stale tasks recovered');
          }
          this.lastCleanup = Date.now();
        }

        // 拉取任务（原子操作）
        const taskRecord = await this.taskStore.dequeue();

        if (taskRecord) {
          this.pollInterval = this.pollIntervalMin;
          this._executeTask(taskRecord);
        } else {
          // 自适应退避
          this.pollInterval = Math.min(this.pollInterval * 1.5, this.pollIntervalMax);
          await this._sleep(this.pollInterval);
        }
      } catch (err) {
        this.emit('error', err);
        this.logger.error({ err }, 'Scheduler error');
        await this._sleep(1000);
      }
    }
    this.emit('stopped');
  }

  async _executeTask(taskRecord) {
    const taskId = taskRecord.id;
    this.activeTasks.add(taskId);

    // 异步执行，不阻塞循环
    (async () => {
      try {
        const payload = JSON.parse(taskRecord.payload);
        this.emit('task:started', { taskId, payload });
        this.logger.info({ taskId, command: payload.command }, 'Task started');

        const result = await this.executor.run(payload, {
          onProgress: async (progress, checkpoint) => {
            await this.taskStore.updateProgress(taskId, progress, checkpoint);
            this.emit('task:progress', { taskId, progress });
          }
        });

        await this.taskStore.markCompleted(taskId);
        this.emit('task:completed', { taskId, result });
        this.logger.info({ taskId, exitCode: result.exitCode }, 'Task completed');
      } catch (err) {
        await this.taskStore.markFailed(taskId, err.message);
        this.emit('task:failed', { taskId, error: err.message });
        this.logger.warn({ taskId, error: err.message }, 'Task failed');
      } finally {
        await this.taskStore.releaseLease(taskId);
        this.activeTasks.delete(taskId);
      }
    })().catch(err => {
      this.emit('error', err);
      this.logger.error({ err }, 'Task execution error');
    });
  }

  async stop() {
    this.running = false;
    if (this.activeTasks.size > 0) {
      this.emit('draining', this.activeTasks.size);
      this.logger.info({ remaining: this.activeTasks.size }, 'Draining tasks');
      await Promise.race([
        this._waitForEmpty(),
        this._sleep(30000)
      ]);
    }
    this.logger.info('Scheduler stopped');
  }

  _waitForEmpty() {
    return new Promise(resolve => {
      const check = () => {
        if (this.activeTasks.size === 0) resolve();
        else setTimeout(check, 100);
      };
      check();
    });
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = { Scheduler };
