const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const { v4: uuidv4 } = require('uuid');
const EventEmitter = require('events');

class TaskStore extends EventEmitter {
  constructor(config) {
    super();
    this.dbPath = config.database.path;
    this.wal = config.database.wal;
    this.synchronous = config.database.synchronous;
    this.busyTimeout = config.database.busyTimeout;
    this.leaseTimeoutMs = config.scheduler.leaseTimeoutSec * 1000;

    this.db = null;
    this.writeQueue = [];
    this.flushTimer = null;
    this.batchSize = 20;
    this.flushInterval = 10;
    this.isClosing = false;
  }

  async init() {
    this.db = await open({
      filename: this.dbPath,
      driver: sqlite3.Database
    });

    await this.db.exec(`PRAGMA journal_mode=${this.wal ? 'WAL' : 'DELETE'}`);
    await this.db.exec(`PRAGMA synchronous=${this.synchronous}`);
    await this.db.exec(`PRAGMA busy_timeout=${this.busyTimeout}`);

    await this._createSchema();
    await this.recoverStaleTasks();

    this._startBatchWriter();
    this.emit('ready');
    return this;
  }

  async _createSchema() {
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        priority INTEGER DEFAULT 0,
        progress INTEGER DEFAULT 0,
        checkpoint TEXT,
        lease_expires INTEGER,
        error_message TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status, priority DESC, created_at ASC);
      CREATE INDEX IF NOT EXISTS idx_tasks_lease ON tasks(lease_expires);
    `);
  }

  async recoverStaleTasks() {
    const now = Date.now();
    const result = await this.db.run(
      `UPDATE tasks SET status = 'pending', lease_expires = NULL, updated_at = ?
       WHERE status = 'running' AND lease_expires < ?`,
      now, now
    );
    if (result.changes > 0) {
      this.emit('recovered', result.changes);
    }
    return result.changes;
  }

  async enqueue(task) {
    const id = task.id || uuidv4();
    const now = Date.now();
    const payload = JSON.stringify(task);
    await this.db.run(
      `INSERT INTO tasks (id, payload, status, priority, created_at, updated_at)
       VALUES (?, ?, 'pending', ?, ?, ?)`,
      id, payload, task.priority || 0, now, now
    );
    return { id, status: 'pending' };
  }

  /**
   * M1 修复：原子性 dequeue - 使用单条 UPDATE ... RETURNING
   */
  async dequeue() {
    const now = Date.now();
    const leaseExpires = now + this.leaseTimeoutMs;

    try {
      // 使用单条 SQL 原子操作
      const result = await this.db.get(`
        UPDATE tasks
        SET status = 'running', lease_expires = ?, updated_at = ?
        WHERE id = (
          SELECT id FROM tasks
          WHERE status = 'pending'
          ORDER BY priority DESC, created_at ASC
          LIMIT 1
        )
        RETURNING *
      `, leaseExpires, now);
      
      return result || null;
    } catch (err) {
      // SQLite 版本不支持 RETURNING，使用备用方案
      if (err.message.includes('RETURNING') || err.message.includes('near "RETURNING"')) {
        return this.dequeueFallback();
      }
      throw err;
    }
  }

  /**
   * 备用 dequeue 方案（兼容旧版 SQLite）
   */
  async dequeueFallback() {
    const now = Date.now();
    const leaseExpires = now + this.leaseTimeoutMs;

    await this.db.run('BEGIN IMMEDIATE');
    
    try {
      const candidate = await this.db.get(`
        SELECT id FROM tasks
        WHERE status = 'pending'
        ORDER BY priority DESC, created_at ASC
        LIMIT 1
      `);

      if (!candidate) {
        await this.db.run('COMMIT');
        return null;
      }

      await this.db.run(
        `UPDATE tasks
         SET status = 'running', lease_expires = ?, updated_at = ?
         WHERE id = ? AND status = 'pending'`,
        leaseExpires, now, candidate.id
      );

      const result = await this.db.get('SELECT * FROM tasks WHERE id = ?', candidate.id);
      await this.db.run('COMMIT');
      return result;
    } catch (err) {
      await this.db.run('ROLLBACK').catch(() => {});
      throw err;
    }
  }

  /**
   * M2 修复：批量写入增加指数退避
   */
  _startBatchWriter() {
    let backoffMs = 10;
    const maxBackoffMs = 5000;
    let consecutiveFailures = 0;

    this.flushTimer = setInterval(async () => {
      if (this.writeQueue.length === 0 || this.isClosing) {
        // 成功后重置退避
        backoffMs = 10;
        consecutiveFailures = 0;
        return;
      }

      const batch = this.writeQueue.splice(0, this.batchSize);
      try {
        await this.db.run('BEGIN TRANSACTION');
        for (const item of batch) {
          await this.db.run(item.sql, item.params);
        }
        await this.db.run('COMMIT');
        // 成功后重置
        backoffMs = 10;
        consecutiveFailures = 0;
      } catch (err) {
        consecutiveFailures++;
        this.emit('error', err);
        this.writeQueue.unshift(...batch);
        
        // 指数退避
        await new Promise(resolve => setTimeout(resolve, backoffMs));
        backoffMs = Math.min(backoffMs * 2, maxBackoffMs);
        
        this.logger?.warn({ 
          consecutiveFailures, 
          backoffMs, 
          queueLength: this.writeQueue.length 
        }, 'Batch write failed, applying exponential backoff');
      }
    }, this.flushInterval);
  }

  _enqueueWrite(sql, params) {
    this.writeQueue.push({ sql, params });
  }

  async updateProgress(taskId, progress, checkpointData = null) {
    this._enqueueWrite(
      `UPDATE tasks SET progress = ?, checkpoint = ?, updated_at = ? WHERE id = ?`,
      [progress, checkpointData ? JSON.stringify(checkpointData) : null, Date.now(), taskId]
    );
  }

  async markCompleted(taskId) {
    this._enqueueWrite(
      `UPDATE tasks SET status = 'completed', lease_expires = NULL, updated_at = ? WHERE id = ?`,
      [Date.now(), taskId]
    );
  }

  async markFailed(taskId, errorMessage) {
    this._enqueueWrite(
      `UPDATE tasks SET status = 'failed', lease_expires = NULL, error_message = ?, updated_at = ? WHERE id = ?`,
      [errorMessage, Date.now(), taskId]
    );
  }

  async releaseLease(taskId) {
    await this.db.run(
      `UPDATE tasks SET lease_expires = NULL, updated_at = ? WHERE id = ?`,
      Date.now(), taskId
    );
  }

  async getTask(taskId) {
    return this.db.get('SELECT * FROM tasks WHERE id = ?', taskId);
  }

  async getStats() {
    return this.db.get(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) as running,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
      FROM tasks
    `);
  }

  async cleanupOldTasks(retentionDays = 7) {
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const result = await this.db.run(
      `DELETE FROM tasks WHERE status IN ('completed', 'failed') AND updated_at < ?`,
      cutoff
    );
    return result.changes;
  }

  async close() {
    this.isClosing = true;
    if (this.flushTimer) clearInterval(this.flushTimer);
    
    if (this.writeQueue.length > 0) {
      await this.db.run('BEGIN TRANSACTION');
      for (const item of this.writeQueue) {
        await this.db.run(item.sql, item.params);
      }
      await this.db.run('COMMIT');
      this.writeQueue = [];
    }
    await this.db.close();
  }
}

module.exports = { TaskStore };
