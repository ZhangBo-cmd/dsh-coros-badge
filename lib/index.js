// dsh-coros-badge —— node（Host）半边。
// 注册 /coros-summary 接口：读取 coros-mcp 已缓存的 OAuth token（自动续期），
// 直连 COROS MCP 查询设备型号、运动记录、恢复度，做简单规则点评，返回 JSON 给浏览器半边。
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export const name = "dsh-coros-badge";
export const inject = ["webServer"];

// 根据 coros-mcp 登录时落盘的地区目录（cn/eu/us）自动选择区域端点
const REGION_ISSUERS = {
  cn: "https://mcpcn.coros.com",
  eu: "https://mcpeu.coros.com",
  us: "https://mcpus.coros.com",
};
const DEFAULT_ISSUER = process.env.COROS_MCP_ISSUER || "https://mcpcn.coros.com";
const STATE_ROOT = join(homedir(), ".coros-mcp-skill-gateway-ts");
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 分钟缓存

const nowEpoch = () => Math.floor(Date.now() / 1000);
const yyyyMMdd = (d) =>
  `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
// 记录里的日期是 "YYYY-MM-DD"（带横杠），近30天过滤要用同样格式
const yyyy_MM_dd = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// ---- token ----
function findTokenFile() {
  if (!existsSync(STATE_ROOT)) return null;
  try {
    for (const entry of readdirSync(STATE_ROOT)) {
      const p = join(STATE_ROOT, entry, "token.json");
      if (existsSync(p)) return { path: p, region: entry };
    }
  } catch {}
  return null;
}

function loadToken() {
  const f = findTokenFile();
  if (!f) return null;
  try {
    return {
      path: f.path,
      issuer: REGION_ISSUERS[f.region] || DEFAULT_ISSUER,
      data: JSON.parse(readFileSync(f.path, "utf8")),
    };
  } catch {
    return null;
  }
}

function saveToken(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

const isExpired = (t) => nowEpoch() + 60 >= Number(t.expires_at_epoch ?? 0);

async function ensureToken() {
  const t = loadToken();
  if (!t) throw new Error("no COROS token cache — run `coros-mcp login` first");
  if (!isExpired(t.data)) return { issuer: t.issuer, token: t.data };

  const res = await fetch(`${t.issuer}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: String(t.data.client_id ?? ""),
      refresh_token: String(t.data.refresh_token ?? ""),
    }),
  });
  const raw = await res.text();
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new Error(`COROS token refresh failed (HTTP ${res.status})`);
  }
  if (!res.ok || !payload.access_token || !payload.refresh_token) {
    throw new Error("COROS token refresh failed — run `coros-mcp.cmd login` again");
  }
  const next = {
    access_token: payload.access_token,
    refresh_token: payload.refresh_token,
    expires_at_epoch: nowEpoch() + Number(payload.expires_in ?? 3600),
    token_type: String(payload.token_type ?? "Bearer"),
    scope: String(payload.scope ?? ""),
    client_id: String(t.data.client_id ?? payload.client_id ?? ""),
  };
  saveToken(t.path, next);
  return { issuer: t.issuer, token: next };
}

function parseBody(raw, contentType) {
  if ((contentType || "").includes("text/event-stream")) {
    let data = "";
    for (const line of raw.split(/\r?\n/)) {
      if (line.startsWith("data:")) data += line.slice(5).trimStart();
    }
    return data ? JSON.parse(data) : {};
  }
  return raw ? JSON.parse(raw) : {};
}

/** 调用一个 COROS MCP 工具，返回其文本内容（已去掉 JSON 字符串包装）。 */
async function corosCall(tool, args) {
  const { issuer, token } = await ensureToken();
  const res = await fetch(`${issuer}/mcp`, {
    method: "POST",
    headers: {
      Authorization: `${token.token_type} ${token.access_token}`,
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: tool, arguments: args },
    }),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`COROS ${tool} HTTP ${res.status}`);
  const payload = parseBody(raw, res.headers.get("content-type"));
  if (payload.error) throw new Error(`COROS ${tool} error: ${JSON.stringify(payload.error)}`);
  const text = payload.result?.content?.[0]?.text;
  if (typeof text === "string") {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return "";
}

// ---- 解析 ----
function parseDeviceName(text) {
  const names = [...text.matchAll(/^\d+\.\s+(.+)$/gm)].map((m) => m[1].trim());
  return names.length ? names[names.length - 1] : null; // 最后一条设备 = 当前手表
}

function parseRecovery(text) {
  const m = text.match(/Recovery:\s*(\d+)\s*%/);
  return m ? Number(m[1]) : null;
}

/** 把 "Sport Records" 文本拆成 [{date, km, sport}]（跳过标题块等非记录块）。 */
function parseRecords(text) {
  const records = [];
  for (const block of text.split(/\n\s*\n/)) {
    // 记录块以 "N. 项目 — YYYY-MM-DD" 开头；标题块 "Sport Records — ..." 不匹配，直接跳过
    const head = block.match(/^\s*(\d+)\.\s+(.+?)\s*—\s*(\d{4}-\d{2}-\d{2})/);
    if (!head) continue;
    const distM = block.match(/Distance:\s*([\d.]+)\s*km/);
    records.push({
      date: head[3],
      km: distM ? parseFloat(distM[1]) : 0,
      sport: head[2].trim(),
    });
  }
  return records;
}

// ---- 点评 / 建议（规则） ----
function buildReview(recentDays, recentKm, recovery) {
  let comment;
  if (recentDays >= 12) comment = `近30天运动 ${recentDays} 天、累计 ${recentKm} km，节奏稳定、有氧基础扎实。`;
  else if (recentDays >= 8) comment = `近30天运动 ${recentDays} 天、累计 ${recentKm} km，保持得不错。`;
  else if (recentDays >= 4) comment = `近30天只运动了 ${recentDays} 天，训练量偏少。`;
  else comment = `近30天几乎没怎么动（${recentDays} 天），需要尽快重启训练。`;

  let suggestion;
  if (recovery == null) suggestion = `建议每周 3 次以上，并加入一次速度课和一次长距离。`;
  else if (recovery < 50) suggestion = `当前恢复度 ${recovery}% 偏低，先充分休息再上强度。`;
  else if (recovery < 70) suggestion = `当前恢复度 ${recovery}%，建议以轻松跑为主、别急着加量。`;
  else suggestion = `恢复度 ${recovery}% 良好，可安排一次速度课或长距离刺激。`;
  return { comment, suggestion };
}

// ---- 汇总 + 缓存 ----
let cache = null;
async function getSummary() {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.data;

  const devices = await corosCall("queryDevices", {});
  const model = parseDeviceName(devices);

  const today = yyyyMMdd(new Date());
  const recordsText = await corosCall("querySportRecords", {
    startDate: "20200101",
    endDate: today,
    sportTypeCodes: [65535],
    limit: 5000,
  });
  const records = parseRecords(recordsText);
  const totalDays = new Set(records.map((r) => r.date)).size;

  const cutoff = new Date(Date.now() - 30 * 86400000);
  const cutoffStr = yyyy_MM_dd(cutoff);
  const recent = records.filter((r) => r.date >= cutoffStr);
  const recentDays = new Set(recent.map((r) => r.date)).size;
  const recentKm = Math.round(recent.reduce((s, r) => s + r.km, 0) * 10) / 10;

  let recovery = null;
  try {
    recovery = parseRecovery(await corosCall("queryRecoveryStatus", {}));
  } catch {}

  const { comment, suggestion } = buildReview(recentDays, recentKm, recovery);

  const data = {
    ok: true,
    model,
    totalDays,
    recentDays,
    recentKm,
    recovery,
    comment,
    suggestion,
  };
  cache = { at: Date.now(), data };
  return data;
}

export function apply(ctx) {
  ctx.effect(() =>
    ctx.webServer.register({
      kind: "exact",
      path: "/coros-summary",
      handler: async (req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-store");
        try {
          res.writeHead(200);
          res.end(JSON.stringify(await getSummary()));
        } catch (err) {
          res.writeHead(200);
          res.end(JSON.stringify({ ok: false, error: String((err && err.message) || err) }));
        }
      },
    }),
  );
}
