const ACTION_MAP = [
  { keyword: "送水", action: "water" },
  { keyword: "结账", action: "checkout" },
  { keyword: "收餐", action: "cleanup" },
  { keyword: "点餐", action: "order" },
  { keyword: "普通点餐", action: "order" }
];

export function parseNaturalCommand(text) {
  const cleaned = String(text || "").trim();
  if (!cleaned) {
    return { ok: false, message: "请输入指令文本。" };
  }

  const tableMatch = cleaned.match(/([1-4])号桌/);
  if (!tableMatch) {
    return { ok: false, message: "未识别桌台编号，请包含“1号桌~4号桌”。" };
  }
  const tableId = tableMatch[1];

  const orderedActions = [];
  const actionRegex = /(送水|结账|收餐|普通点餐|点餐)/g;
  let m = actionRegex.exec(cleaned);
  while (m) {
    const token = m[1];
    const found = ACTION_MAP.find((item) => item.keyword === token);
    if (found) orderedActions.push(found.action);
    m = actionRegex.exec(cleaned);
  }

  if (orderedActions.length === 0) {
    return { ok: false, message: "未识别到可执行动作（送水/结账/收餐/点餐）。" };
  }

  return {
    ok: true,
    tableId,
    actions: orderedActions
  };
}
