const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { ExecutionGuard } = require('./ExecutionGuard');
const { SecurityGateway } = require('../security/SecurityGateway');
const { loadSkill } = require('../skills/skillLoader');

class SandboxExecutor {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.workspaceRoot = config.executor.workspaceRoot;
    this.allowedCommands = config.executor.allowedCommands;
    this.maxOutputBytes = config.executor.maxOutputBytes;
    this.idleTimeoutMs = config.executor.idleTimeoutSec * 1000;
    this.memoryLimitMB = config.executor.memoryLimitMB;
    this.uid = config.executor.uid;
    this.gid = config.executor.gid;

    this.security = new SecurityGateway(config);
  }

  async run(task, callbacks = {}) {
    const { onProgress } = callbacks;
    const taskId = task.id || 'unknown';

    // === 技能任务分支 ===
    if (task.type === 'skill' && task.skillName) {
      return this._runSkill(task, callbacks);
    }

    // 1. 安全校验
    const validation = this.security.validateCommand(task.command, task.args || [], task.cwd);
    if (!validation.valid) {
      throw new Error(`Command rejected: ${validation.reason}`);
    }

    // 2. 准备参数
    const cmd = task.command;
    const args = task.args || [];
    const cwd = this._resolveCwd(task.cwd);
    const env = { ...process.env, ...(task.env || {}) };
    const timeout = task.timeout * 1000 || 3600000;

    // 3. 创建防卡死守卫
    const guard = new ExecutionGuard({
      maxOutputBytes: this.maxOutputBytes,
      idleTimeoutMs: this.idleTimeoutMs
    });

    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let killed = false;
      let exitCode = null;
      let truncated = false;
      let lastCheckpointSize = 0;
      const CHECKPOINT_INTERVAL = 64 * 1024;

      // 4. 构建 spawn 选项（权限降级在 spawn 时生效）
      const spawnOptions = {
        cwd,
        env,
        detached: false,
        stdio: ['ignore', 'pipe', 'pipe']
      };

      // 在 spawn 选项里直接指定 uid/gid（仅非 Windows）
      if (process.platform !== 'win32') {
        if (this.uid) spawnOptions.uid = this.uid;
        if (this.gid) spawnOptions.gid = this.gid;
      }

      // 启动子进程
      const child = spawn(cmd, args, spawnOptions);

      const pid = child.pid;

      // 超时总控
      const timeoutId = setTimeout(() => {
        if (!killed) {
          killed = true;
          child.kill('SIGKILL');
          guard.stop();
          reject(new Error(`Task timed out after ${timeout}ms`));
        }
      }, timeout);

      // 启动守卫监控
      guard.start();

      // 守卫事件：无产出
      guard.on('starvation', (data) => {
        if (!killed) {
          killed = true;
          child.kill('SIGKILL');
          guard.stop();
          reject(new Error(`Task starved: no output for ${data.idleSeconds}s`));
        }
      });

      // 守卫事件：输出超限
      guard.on('memory_limit', (data) => {
        if (!killed) {
          killed = true;
          truncated = true;
          child.kill('SIGKILL');
          guard.stop();
        }
      });

      // 处理 stdout
      child.stdout.on('data', (chunk) => {
        const ok = guard.feedOutput(chunk, 'stdout');
        if (!ok && !killed) {
          killed = true;
          truncated = true;
          child.kill('SIGKILL');
          guard.stop();
          return;
        }

        stdout += chunk.toString();

        // 检查点写入
        if (stdout.length - lastCheckpointSize >= CHECKPOINT_INTERVAL) {
          lastCheckpointSize = stdout.length;
          const progress = Math.min(99, Math.floor((stdout.length / this.maxOutputBytes) * 100));
          if (onProgress) {
            onProgress(progress, { outputLength: stdout.length }).catch(() => {});
          }
        }
      });

      child.stderr.on('data', (chunk) => {
        guard.feedOutput(chunk, 'stderr');
        stderr += chunk.toString();
      });

      child.on('error', (err) => {
        clearTimeout(timeoutId);
        guard.stop();
        reject(err);
      });

      child.on('close', (code) => {
        clearTimeout(timeoutId);
        guard.stop();

        if (killed) {
          if (truncated) {
            reject(new Error(`Output exceeded ${this.maxOutputBytes} bytes limit`));
          } else {
            reject(new Error('Task was forcefully terminated'));
          }
          return;
        }

        exitCode = code;

        // 最终进度
        if (onProgress) {
          onProgress(100, { outputLength: stdout.length }).catch(() => {});
        }

        // 脱敏处理
        const safeStdout = this.security.maskSecrets(stdout);
        const safeStderr = this.security.maskSecrets(stderr);

        resolve({
          exitCode,
          stdout: safeStdout,
          stderr: safeStderr,
          truncated,
          pid
        });
      });
    });
  }

  _resolveCwd(cwd) {
    if (!cwd) return this.workspaceRoot;
    const resolved = path.resolve(this.workspaceRoot, cwd);
    if (!resolved.startsWith(path.resolve(this.workspaceRoot))) {
      throw new Error(`cwd ${cwd} escapes workspace root`);
    }
    if (!fs.existsSync(resolved)) {
      fs.mkdirSync(resolved, { recursive: true });
    }
    return resolved;
  }

  // === 技能执行方法 ===
  async _runSkill(task, callbacks = {}) {
    const { onProgress } = callbacks;
    const { skillName, skillParams } = task;

    const skill = loadSkill(skillName);
    if (!skill) {
      throw new Error(`Skill ${skillName} not available`);
    }

    // 创建 ExecutionGuard（技能允许更长无产出时间）
    const guard = new ExecutionGuard({
      maxOutputBytes: this.maxOutputBytes,
      idleTimeoutMs: this.idleTimeoutMs * 2
    });
    guard.start();

    try {
      // 根据不同技能调整参数格式
      let result;
      if (skillName === 'auto_improve') {
        // autoImproveProject(goal, projectPath, maxIterations)
        const { goal, projectPath, maxIterations } = skillParams;
        result = await skill.execute(goal, projectPath, maxIterations);
      } else {
        // 默认：传入整个 skillParams 对象
        result = await skill.execute(skillParams, {
          onProgress,
          workspaceRoot: this.workspaceRoot,
          security: this.security
        });
      }
      guard.stop();
      return { exitCode: 0, stdout: JSON.stringify(result), stderr: '' };
    } catch (err) {
      guard.stop();
      throw err;
    }
  }
}

module.exports = { SandboxExecutor };
