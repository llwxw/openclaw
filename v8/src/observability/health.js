const os = require('os');
const { execSync } = require('child_process');

class HealthChecker {
  constructor(config, taskStore) {
    this.config = config;
    this.taskStore = taskStore;
    this.startTime = Date.now();
  }

  async check() {
    const disk = this._checkDisk();
    const memory = this._checkMemory();
    const queue = await this.taskStore.getStats();

    let status = 'healthy';
    if (disk.status === 'critical' || memory.status === 'critical') {
      status = 'degraded';
    }

    // 磁盘满时拒绝新任务
    if (disk.status === 'critical') {
      status = 'down';
    }

    return {
      status,
      timestamp: Date.now(),
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      version: '8.0.0',
      disk,
      memory,
      queue
    };
  }

  _checkDisk() {
    try {
      const targetPath = this.config.health.disk.path;
      let usagePercent = 0;
      
      if (process.platform === 'win32') {
        usagePercent = 0;
      } else {
        const output = execSync(`df -k ${targetPath} | tail -1`, { encoding: 'utf8' });
        const parts = output.trim().split(/\s+/);
        usagePercent = parseInt(parts[4].replace('%', ''));
      }

      const warning = this.config.health.disk.warningThreshold;
      const critical = this.config.health.disk.criticalThreshold;
      let diskStatus = 'healthy';
      if (usagePercent >= critical) diskStatus = 'critical';
      else if (usagePercent >= warning) diskStatus = 'warning';

      return { usagePercent, status: diskStatus };
    } catch (err) {
      return { usagePercent: -1, status: 'unknown', error: err.message };
    }
  }

  _checkMemory() {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedPercent = ((totalMem - freeMem) / totalMem) * 100;

    const warning = this.config.health.memory.warningThreshold;
    const critical = this.config.health.memory.criticalThreshold;
    let memStatus = 'healthy';
    if (usedPercent >= critical) memStatus = 'critical';
    else if (usedPercent >= warning) memStatus = 'warning';

    return {
      totalMB: Math.floor(totalMem / 1024 / 1024),
      freeMB: Math.floor(freeMem / 1024 / 1024),
      usedPercent: Math.round(usedPercent * 10) / 10,
      status: memStatus
    };
  }
}

module.exports = { HealthChecker };
