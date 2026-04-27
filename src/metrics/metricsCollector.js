export function createMetricsCollector() {
  const metrics = {
    queued: 0,
    completed: 0,
    peakQueue: 0,
    responseTimes: [],
    cycleTimes: [],
    startedAtMap: new Map()
  };

  const dom = {
    avgResponse: document.getElementById("metric-avg-response"),
    completionRate: document.getElementById("metric-completion-rate"),
    peakQueue: document.getElementById("metric-peak-queue"),
    avgWait: document.getElementById("metric-avg-wait")
  };

  function avg(values) {
    if (values.length === 0) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  function render() {
    const avgResponse = avg(metrics.responseTimes) / 1000;
    const avgWait = avg(metrics.cycleTimes) / 1000;
    const completionRate = metrics.queued === 0 ? 0 : (metrics.completed / metrics.queued) * 100;

    dom.avgResponse.textContent = `${avgResponse.toFixed(1)}s`;
    dom.avgWait.textContent = `${avgWait.toFixed(1)}s`;
    dom.peakQueue.textContent = String(metrics.peakQueue);
    dom.completionRate.textContent = `${completionRate.toFixed(0)}%`;
  }

  return {
    onTaskQueued(task) {
      metrics.queued += 1;
      metrics.startedAtMap.set(task.id, { createdAt: task.createdAt, startAt: null });
      render();
    },
    onQueueSize(size) {
      metrics.peakQueue = Math.max(metrics.peakQueue, size);
      render();
    },
    onTaskStarted(task) {
      const rec = metrics.startedAtMap.get(task.id);
      if (!rec) return;
      rec.startAt = performance.now();
      metrics.responseTimes.push(rec.startAt - task.createdAt);
      render();
    },
    onTaskCompleted(task) {
      metrics.completed += 1;
      const rec = metrics.startedAtMap.get(task.id);
      if (rec && rec.startAt != null) {
        metrics.cycleTimes.push(performance.now() - rec.startAt);
      }
      metrics.startedAtMap.delete(task.id);
      render();
    },
    reset() {
      metrics.queued = 0;
      metrics.completed = 0;
      metrics.peakQueue = 0;
      metrics.responseTimes.length = 0;
      metrics.cycleTimes.length = 0;
      metrics.startedAtMap.clear();
      render();
    },
    render
  };
}
