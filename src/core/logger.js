import { LOG_LIMIT } from "../config/appConfig.js";

export function createLogger({ replayRecorder }) {
  const logListEl = document.getElementById("log-list");

  function append(message, { replayTag = false, record = true } = {}) {
    const timeText = new Date().toLocaleTimeString("zh-CN", { hour12: false });
    const li = document.createElement("li");
    li.textContent = `[${timeText}] ${message}`;
    if (replayTag) li.style.color = "#ffd27f";
    logListEl.appendChild(li);

    while (logListEl.children.length > LOG_LIMIT) {
      logListEl.removeChild(logListEl.firstChild);
    }
    logListEl.parentElement.scrollTop = logListEl.parentElement.scrollHeight;

    if (record && replayRecorder) {
      replayRecorder.record("log", message);
    }
  }

  function clear() {
    logListEl.innerHTML = "";
  }

  return { log: append, clear };
}
