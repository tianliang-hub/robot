const http = require("http");
const { URL } = require("url");
require("dotenv").config();

const PORT = Number(process.env.CHAT_PROXY_PORT || 8787);
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || "";
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat";
const DEEPSEEK_URL = process.env.DEEPSEEK_URL || "https://api.deepseek.com/chat/completions";

function json(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization"
  });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 2 * 1024 * 1024) {
        reject(new Error("Body too large"));
      }
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (_error) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

async function askDeepSeek(payload) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetch(DEEPSEEK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${DEEPSEEK_API_KEY}`
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = data?.error?.message || "DeepSeek request failed";
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  if (req.method === "OPTIONS") {
    return json(res, 200, { ok: true });
  }
  if (req.method !== "POST" || url.pathname !== "/api/chat") {
    return json(res, 404, { ok: false, message: "Not found" });
  }
  if (!DEEPSEEK_API_KEY) {
    return json(res, 500, { ok: false, message: "DEEPSEEK_API_KEY 未配置" });
  }

  try {
    const body = await readBody(req);
    const messages = Array.isArray(body.messages) ? body.messages : [];
    if (messages.length === 0) {
      return json(res, 400, { ok: false, message: "messages 不能为空" });
    }
    const payload = {
      model: body.model || DEEPSEEK_MODEL,
      messages,
      temperature: typeof body.temperature === "number" ? body.temperature : 0.6,
      stream: false
    };
    const result = await askDeepSeek(payload);
    const reply = result?.choices?.[0]?.message?.content || "抱歉，我暂时没有想到合适回复。";
    return json(res, 200, {
      ok: true,
      reply,
      usage: result.usage || null
    });
  } catch (error) {
    const statusCode = Number(error.status) || 500;
    return json(res, statusCode, {
      ok: false,
      message: error.message || "请求失败"
    });
  }
});

server.listen(PORT, () => {
  console.log(`[chat-proxy] running at http://localhost:${PORT}`);
});
