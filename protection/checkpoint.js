/**
 * OpenClaw 保护层 - 检查点与自动恢复
 * 
 * 功能：
 * - 任务步骤级检查点
 * - 原子写入（先写临时文件再 rename）
 * - 校验和验证
 * - 自动恢复
 * - 备份文件
 * 
 * 配置：
 * - OPENCLAW_CHECKPOINT_DIR: 检查点目录（默认 /var/openclaw/checkpoints）
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as os from 'os';

class CheckpointManager {
  constructor() {
    this.checkpointDir = process.env.OPENCLAW_CHECKPOINT_DIR || '/var/openclaw/checkpoints';
    this.version = 1;
    this.ensureDir();
  }

  /**
   * 确保检查点目录存在
   */
  ensureDir() {
    if (!fs.existsSync(this.checkpointDir)) {
      try {
        fs.mkdirSync(this.checkpointDir, { recursive: true });
      } catch (err) {
        // 如果目录创建失败，使用临时目录
        this.checkpointDir = path.join(os.tmpdir(), 'openclaw', 'checkpoints');
        fs.mkdirSync(this.checkpointDir, { recursive: true });
      }
    }
  }

  /**
   * 验证 taskId 格式（防止路径遍历攻击）
   * @param {string} taskId - 任务ID
   * @returns {string} 验证后的taskId
   */
  validateTaskId(taskId) {
    // 只允许字母、数字、下划线、连字符
    if (!/^[a-zA-Z0-9_-]+$/.test(taskId)) {
      throw new Error(`Invalid taskId: ${taskId}. Only alphanumeric, underscore, hyphen allowed.`);
    }
    // 限制长度
    if (taskId.length > 128) {
      throw new Error('taskId too long (max 128)');
    }
    return taskId;
  }

  /**
   * 获取检查点文件路径
   * @param {string} taskId - 任务ID
   * @returns {string} 文件路径
   */
  getCheckpointPath(taskId) {
    const safeId = this.validateTaskId(taskId);
    const filepath = path.join(this.checkpointDir, `${safeId}.json`);
    // 验证最终路径在允许目录内
    if (!filepath.startsWith(this.checkpointDir)) {
      throw new Error('Path traversal detected');
    }
    return filepath;
  }

  /**
   * 获取备份文件路径
   * @param {string} taskId - 任务ID
   * @returns {string} 备份文件路径
   */
  getBackupPath(taskId) {
    const safeId = this.validateTaskId(taskId);
    return path.join(this.checkpointDir, `${safeId}.json.bak`);
  }

  /**
   * 生成校验和
   * @param {Object} data - 数据
   * @returns {string} SHA256 校验和
   */
  generateChecksum(data) {
    const json = JSON.stringify(data, Object.keys(data).sort());
    return crypto.createHash('sha256').update(json).digest('hex');
  }

  /**
   * 原子写入 JSON 文件
   * @param {string} filepath - 文件路径
   * @param {Object} data - 数据
   */
  atomicWrite(filepath, data) {
    const tmpPath = filepath + '.tmp';
    const json = JSON.stringify(data, null, 2);
    
    // 写入临时文件
    fs.writeFileSync(tmpPath, json, 'utf8');
    
    // fsync 刷数据
    const fd = fs.openSync(tmpPath, 'r+');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    
    // rename 原子覆盖
    fs.renameSync(tmpPath, filepath);
    
    // 写备份
    fs.copyFileSync(filepath, filepath + '.bak');
  }

  /**
   * 读取检查点
   * @param {string} taskId - 任务ID
   * @returns {Object|null} 检查点数据或 null
   */
  loadCheckpoint(taskId) {
    const filepath = this.getCheckpointPath(taskId);
    const backupPath = this.getBackupPath(taskId);
    
    // 尝试加载主要文件
    try {
      if (fs.existsSync(filepath)) {
        const data = JSON.parse(fs.readFileSync(filepath, 'utf8'));
        
        // 验证校验和
        const storedChecksum = data.checksum;
        delete data.checksum;
        const computedChecksum = this.generateChecksum(data);
        
        if (storedChecksum === computedChecksum) {
          return data;
        } else {
          console.warn(`[检查点] 校验和不匹配，尝试备份`);
        }
      }
    } catch (err) {
      console.warn(`[检查点] 读取失败: ${err.message}`);
    }
    
    // 尝试加载备份
    try {
      if (fs.existsSync(backupPath)) {
        const data = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
        const storedChecksum = data.checksum;
        delete data.checksum;
        const computedChecksum = this.generateChecksum(data);
        
        if (storedChecksum === computedChecksum) {
          console.log(`[检查点] 从备份恢复: ${taskId}`);
          return data;
        }
      }
    } catch (err) {
      console.warn(`[检查点] 读取备份失败: ${err.message}`);
    }
    
    return null;
  }

  /**
   * 保存检查点
   * @param {string} taskId - 任务ID
   * @param {Object} state - 状态数据
   */
  saveCheckpoint(taskId, state) {
    const filepath = this.getCheckpointPath(taskId);
    
    const data = {
      taskId,
      ...state,
      version: this.version,
      timestamp: new Date().toISOString()
    };
    
    // 添加校验和
    data.checksum = this.generateChecksum(data);
    
    this.atomicWrite(filepath, data);
  }

  /**
   * 删除检查点
   * @param {string} taskId - 任务ID
   */
  deleteCheckpoint(taskId) {
    const filepath = this.getCheckpointPath(taskId);
    const backupPath = this.getBackupPath(taskId);
    
    try {
      if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
      if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
    } catch (err) {
      console.warn(`[检查点] 删除失败: ${err.message}`);
    }
  }

  /**
   * 获取所有未完成任务
   * @returns {Array} 未完成任务列表
   */
  getIncompleteTasks() {
    try {
      const files = fs.readdirSync(this.checkpointDir);
      const tasks = [];
      
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        if (file.endsWith('.bak')) continue;
        
        const taskId = file.replace('.json', '');
        const checkpoint = this.loadCheckpoint(taskId);
        
        if (checkpoint && checkpoint.status !== 'completed') {
          tasks.push(checkpoint);
        }
      }
      
      return tasks;
    } catch (err) {
      console.warn(`[检查点] 扫描失败: ${err.message}`);
      return [];
    }
  }

  /**
   * 恢复任务执行
   * @param {Object} task - 任务对象
   * @param {Function} executor - 执行函数
   * @returns {Promise} 执行结果
   */
  async resume(task, executor) {
    const checkpoint = this.loadCheckpoint(task.id);
    
    if (!checkpoint) {
      // 没有检查点，从头开始
      return executor(task, 0);
    }
    
    const lastStep = checkpoint.lastCompletedStep ?? -1;
    console.log(`[检查点] 恢复任务 ${task.id} 从步骤 ${lastStep + 1} 开始`);
    
    return executor(task, lastStep + 1);
  }
}

// 导出单例
export const checkpointManager = new CheckpointManager();

export default checkpointManager;