class MetricsCollector {
  constructor() {
    this.metrics = {
      tasks_submitted: 0,
      tasks_completed: 0,
      tasks_failed: 0,
      tasks_starved: 0,
      tasks_truncated: 0
    };
  }

  inc(name, value = 1) {
    if (this.metrics[name] !== undefined) {
      this.metrics[name] += value;
    }
  }

  getMetrics() {
    return { ...this.metrics };
  }

  reset() {
    for (const key in this.metrics) {
      this.metrics[key] = 0;
    }
  }
}

module.exports = { MetricsCollector };
