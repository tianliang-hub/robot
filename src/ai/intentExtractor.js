export function extractIntent(text) {
  const content = String(text || "").trim();
  if (!content) return { type: "none" };
  if (/(聊天结束|结束聊天|先这样|bye|再见)/i.test(content)) {
    return { type: "end_chat" };
  }
  if (/(要水|送水|口渴|来杯水)/.test(content)) {
    return { type: "intent_switch", intent: "water" };
  }
  if (/(结账|买单|付款)/.test(content)) {
    return { type: "intent_switch", intent: "checkout" };
  }
  if (/(点餐|下单|推荐|吃什么)/.test(content)) {
    return { type: "intent_switch", intent: "order" };
  }
  return { type: "chat" };
}
