const DEFAULT_PROXY_URL = import.meta.env.VITE_CHAT_PROXY_URL || "http://localhost:8787";

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestChat(payload) {
  const res = await fetch(`${DEFAULT_PROXY_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    throw new Error(data?.message || `聊天请求失败（${res.status}）`);
  }
  return data;
}

export async function sendMessage({ mode, tableId, sessionId, text, history }) {
  const systemPrompt = mode === "global"
    ? "你是智慧餐厅前台机器人，请用简洁中文回答顾客问题，适度推荐菜品，避免过度承诺。"
    : `你是桌台${tableId}的服务员机器人，请结合餐厅场景回答，语气礼貌、简洁。`;
  const messages = [
    { role: "system", content: systemPrompt },
    ...history.slice(-10),
    { role: "user", content: text }
  ];

  let lastError = null;
  for (let i = 0; i < 2; i += 1) {
    try {
      const result = await requestChat({
        mode,
        tableId,
        sessionId,
        messages
      });
      return result.reply;
    } catch (error) {
      lastError = error;
      await wait(220 * (i + 1));
    }
  }
  throw lastError || new Error("聊天服务不可用");
}
