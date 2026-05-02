const ACTION_MAP = [
  { keyword: "点饮品", action: "water" },
  { keyword: "送水", action: "water" },
  { keyword: "结账", action: "checkout" },
  { keyword: "收餐", action: "cleanup" },
  { keyword: "点餐", action: "order" },
  { keyword: "普通点餐", action: "order" }
];

/** 语音识别「二号桌」等与阿拉伯数字桌号兼容（仅 1~4 桌） */
const CN_TABLE_DIGIT_TO_ID = {
  一: "1",
  二: "2",
  三: "3",
  四: "4",
  壹: "1",
  贰: "2",
  叁: "3",
  肆: "4"
};

export function parseNaturalCommand(text) {
  const cleaned = String(text || "").trim();
  if (!cleaned) {
    return { ok: false, message: "请输入指令文本。" };
  }

  const tableRe = /(?:第\s*)?(?:([1-4])|([一二三四壹贰叁肆]))\s*号\s*桌/;
  const tableMatch = cleaned.match(tableRe);
  if (!tableMatch) {
    return {
      ok: false,
      message:
        "未识别桌台编号，请包含「1号桌~4号桌」或「一号桌~四号桌」（阿拉伯或中文数字均可）。"
    };
  }
  const tableId = tableMatch[1] || CN_TABLE_DIGIT_TO_ID[tableMatch[2]];
  if (!tableId || !/^[1-4]$/.test(tableId)) {
    return { ok: false, message: "桌台编号须为 1~4（阿拉伯或中文数字）。" };
  }

  const orderedActions = [];
  const actionRegex = /(点饮品|送水|结账|收餐|普通点餐|点餐)/g;
  let m = actionRegex.exec(cleaned);
  while (m) {
    const token = m[1];
    const found = ACTION_MAP.find((item) => item.keyword === token);
    if (found) orderedActions.push(found.action);
    m = actionRegex.exec(cleaned);
  }

  if (orderedActions.length === 0) {
    return { ok: false, message: "未识别到可执行动作（点饮品/送水/结账/收餐/点餐）。" };
  }

  return {
    ok: true,
    tableId,
    actions: orderedActions
  };
}
