const EventEmitter = require('events');

class ExecutionGuard extends EventEmitter {
  constructor(options = {}) {
    super();
    this.maxOutputBytes = options.maxOutputBytes || 10 * 1024 * 1024; // 10MB
    this.idleTimeoutMs = options.idleTimeoutMs || 30000; // 30s
    this.checkInterval = options.checkInterval || 1000; // 1s

    this.active = false;
    this.lastOutputTime = null;
    this.totalStdoutBytes = 0;
    this.totalStderrBytes = 0;
    this.timer = null;
  }

  start() {
    if (this.active) return;
    this.active = true;
    this.lastOutputTime = Date.now();
    this.totalStdoutBytes = 0;
    this.totalStderrBytes = 0;

    this.timer = setInterval(() => {
      if (!this.active) return;

      const idle = Date.now() - this.lastOutputTime;
      if (idle > this.idleTimeoutMs) {
        this.active = false;
        this.emit('starvation', {
          reason: 'no_output',
          idleSeconds: Math.floor(idle / 1000)
        });
        this.stop();
        return;
      }

      this.emit('heartbeat', { idleMs: idle });
    }, this.checkInterval);
  }

  feedOutput(chunk, stream = 'stdout') {
    if (!this.active) return false;

    this.lastOutputTime = Date.now();

    if (stream === 'stdout') {
      this.totalStdoutBytes += chunk.length;
      if (this.totalStdoutBytes > this.maxOutputBytes) {
        this.active = false;
        this.emit('memory_limit', {
          reason: 'output_exceeded',
          bytes: this.totalStdoutBytes,
          limit: this.maxOutputBytes
        });
        this.stop();
        return false;
      }
    } else {
      this.totalStderrBytes += chunk.length;
    }

    return true;
  }

  stop() {
    this.active = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  getStats() {
    return {
      idleSeconds: this.active ? Math.floor((Date.now() - this.lastOutputTime) / 1000) : 0,
      totalStdoutBytes: this.totalStdoutBytes,
      totalStderrBytes: this.totalStderrBytes,
      usagePercent: (this.totalStdoutBytes / this.maxOutputBytes) * 100
    };
  }
}

module.exports = { ExecutionGuard };
