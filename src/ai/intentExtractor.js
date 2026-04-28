const PATTERNS = [
  { re: /要水|送水|口渴|来杯水|加水|喝水|喝点水|喝口水|来点水|倒杯水|一杯水|白开水|矿泉水|加一杯水|给我倒水|可乐|雪碧|芬达|汽水|饮料|来杯饮料|拿瓶饮料/g, intent: "water" },
  { re: /结账|买单|付款|埋单|刷卡/g, intent: "checkout" },
  { re: /点餐|下单|推荐|吃什么|点菜|加菜|吃/g, intent: "order" }
];

/**
 * 从左到右扫描，返回本句中出现的业务意图（保序，连续相同意图只记一次）
 */
export function extractIntents(text) {
  const content = String(text || "").trim();
  if (!content) return [];
  if (/(聊天结束|结束聊天|先这样|bye|再见)/i.test(content)) {
    return [];
  }
  const out = [];
  let i = 0;
  while (i < content.length) {
    let bestIntent = null;
    let bestLen = 0;
    const sub = content.slice(i);
    for (const { re, intent } of PATTERNS) {
      const r = new RegExp(re.source, re.flags);
      const m = r.exec(sub);
      if (m && m.index === 0 && m[0].length > bestLen) {
        bestIntent = intent;
        bestLen = m[0].length;
      }
    }
    if (bestIntent) {
      if (out.length === 0 || out[out.length - 1] !== bestIntent) {
        out.push(bestIntent);
      }
      i += bestLen;
    } else {
      i += 1;
    }
  }
  return out;
}

export function extractIntent(text) {
  const content = String(text || "").trim();
  if (!content) return { type: "none" };
  if (/(聊天结束|结束聊天|先这样|bye|再见)/i.test(content)) {
    return { type: "end_chat" };
  }
  if (/(要水|送水|口渴|来杯水|加水|喝水|喝点水|喝口水|来点水|倒杯水|一杯水|白开水|矿泉水|加一杯水|给我倒水|可乐|雪碧|芬达|汽水|饮料|来杯饮料|拿瓶饮料)/.test(content)) {
    return { type: "intent_switch", intent: "water" };
  }
  if (/(结账|买单|付款)/.test(content)) {
    return { type: "intent_switch", intent: "checkout" };
  }
  if (/(点餐|下单|推荐|吃什么|吃)/.test(content)) {
    return { type: "intent_switch", intent: "order" };
  }
  return { type: "chat" };
}
