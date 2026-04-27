export function createReplayRecorder() {
  const events = [];
  let startAt = performance.now();

  return {
    record(type, message, payload = null) {
      events.push({
        type,
        message,
        payload,
        at: performance.now() - startAt
      });
    },
    resetClock() {
      startAt = performance.now();
    },
    clear() {
      events.length = 0;
      startAt = performance.now();
    },
    getEvents() {
      return events.slice();
    },
    async playback(onEvent, speed = 2.0) {
      const snapshot = events.slice();
      if (snapshot.length === 0) return;
      for (let i = 0; i < snapshot.length; i += 1) {
        const current = snapshot[i];
        const prevAt = i === 0 ? 0 : snapshot[i - 1].at;
        const waitMs = (current.at - prevAt) / speed;
        if (waitMs > 0) {
          // eslint-disable-next-line no-await-in-loop
          await new Promise((resolve) => setTimeout(resolve, waitMs));
        }
        onEvent(current);
      }
    }
  };
}
