/**
 * Google OAuth 與 Gmail API（取代 google-api-python-client 與三個 google-auth 套件）。
 *
 * 全部用 Node 內建能力：
 *   fetch          打 REST API
 *   node:http      授權時在本機起一個一次性的接收埠（loopback flow）
 *   node:crypto    產生 state 防 CSRF
 *
 * token.json 沿用 Python 版（google-auth）的欄位格式，所以：
 *   - 學員如果先前用 v1（Python）授權過，v2 可以直接沿用，不必重新授權
 *   - 反之亦然
 *
 * 授權流程裡「在瀏覽器按允許」這一步永遠由使用者本人完成，程式不代按。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { SHARED_DIR } from "./config.mjs";
import { isMain } from "./cli.mjs";

export const SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.modify",
];

const CRED_DIR = join(SHARED_DIR, ".credentials");
export const CLIENT_SECRET_PATH = join(CRED_DIR, "client_secret.json");
export const TOKEN_PATH = join(CRED_DIR, "token.json");
const TOKEN_URI = "https://oauth2.googleapis.com/token";

function readClientSecret() {
  if (!existsSync(CLIENT_SECRET_PATH)) {
    throw new Error(
      `找不到 ${CLIENT_SECRET_PATH}，請先依 shared/references/google-api-setup.md ` +
      "在 Google Cloud Console 建立 OAuth 用戶端 ID 並下載 client_secret.json"
    );
  }
  const j = JSON.parse(readFileSync(CLIENT_SECRET_PATH, "utf8"));
  const c = j.installed ?? j.web ?? j;
  return { clientId: c.client_id, clientSecret: c.client_secret };
}

/**
 * 開使用者的預設瀏覽器。
 *
 * ⚠️ Windows 不要用 `cmd /c start`：授權網址帶 6 個 `&`，而 `&` 在 cmd 是命令
 * 分隔符。Node 用 argv 陣列 spawn 時只會對「含空白或引號」的參數加引號，`&`
 * 不受保護，所以 cmd 會把網址切斷、只開到第一個 `&`（缺 redirect_uri／scope／
 * state，Google 直接回錯誤頁），剩下幾段還被當成指令去執行。
 * 而且 stdio 是 ignore、spawn 本身又成功，這個失敗完全靜默——最難查的那種。
 *
 * 解法：直接 spawn 一個 exe，中間不經過 cmd 的二次解析，`&` 就安全了。
 * rundll32 的 FileProtocolHandler 是 Windows 開預設瀏覽器的標準做法。
 */
const openBrowser = (url) => {
  const [cmd, argv] =
    process.platform === "darwin" ? ["open", [url]]
    : process.platform === "win32" ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
    : ["xdg-open", [url]];
  try { spawn(cmd, argv, { detached: true, stdio: "ignore" }).unref(); } catch { /* 開不起來就讓使用者自己貼網址 */ }
};

/** 一次性授權：起本機接收埠 → 開瀏覽器 → 等使用者按允許 → 換 token */
async function runLoopbackFlow() {
  const { clientId, clientSecret } = readClientSecret();
  const state = randomBytes(16).toString("hex");

  const { server, port, waitForCode } = await new Promise((resolve, reject) => {
    let settle;
    const done = new Promise((res) => { settle = res; });
    const srv = createServer((req, res) => {
      const url = new URL(req.url, "http://localhost");
      const code = url.searchParams.get("code");
      const gotState = url.searchParams.get("state");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      if (code && gotState === state) {
        res.end("<h2>授權完成</h2><p>可以關掉這個視窗，回到 Claude Code 繼續。</p>");
        settle(code);
      } else {
        res.end("<h2>授權未完成</h2><p>請回到 Claude Code 重新執行一次。</p>");
        settle(null);
      }
    });
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => resolve({ server: srv, port: srv.address().port, waitForCode: done }));
  });

  const redirectUri = `http://localhost:${port}`;
  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", SCOPES.join(" "));
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");
  authUrl.searchParams.set("state", state);

  console.log("請在瀏覽器完成授權（這一步一定要你本人點「允許」）：");
  console.log(authUrl.toString());
  openBrowser(authUrl.toString());

  const code = await waitForCode;
  server.close();
  if (!code) throw new Error("授權未完成");

  const res = await fetch(TOKEN_URI, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code, client_id: clientId, client_secret: clientSecret,
      redirect_uri: redirectUri, grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`換取 token 失敗：${res.status} ${await res.text()}`);
  const t = await res.json();

  const creds = {
    token: t.access_token,
    refresh_token: t.refresh_token,
    token_uri: TOKEN_URI,
    client_id: clientId,
    client_secret: clientSecret,
    scopes: SCOPES,
    universe_domain: "googleapis.com",
    expiry: new Date(Date.now() + (t.expires_in ?? 3600) * 1000).toISOString(),
  };
  mkdirSync(CRED_DIR, { recursive: true });
  writeFileSync(TOKEN_PATH, JSON.stringify(creds, null, 2), "utf8");
  return creds;
}

async function refresh(creds) {
  const res = await fetch(creds.token_uri ?? TOKEN_URI, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: creds.client_id, client_secret: creds.client_secret,
      refresh_token: creds.refresh_token, grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`更新 token 失敗：${res.status} ${await res.text()}`);
  const t = await res.json();
  creds.token = t.access_token;
  creds.expiry = new Date(Date.now() + (t.expires_in ?? 3600) * 1000).toISOString();
  writeFileSync(TOKEN_PATH, JSON.stringify(creds, null, 2), "utf8");
  return creds;
}

/** 取得可用的 access token；沒授權過就跑一次授權流程 */
export async function getAccessToken() {
  if (existsSync(TOKEN_PATH)) {
    const creds = JSON.parse(readFileSync(TOKEN_PATH, "utf8"));
    const expired = !creds.expiry || new Date(creds.expiry).getTime() - Date.now() < 60_000;
    if (!expired && creds.token) return creds.token;
    if (creds.refresh_token) return (await refresh(creds)).token;
  }
  return (await runLoopbackFlow()).token;
}

export const hasToken = () => existsSync(TOKEN_PATH);

/** 打 Gmail API。path 例如 "users/me/messages/send" */
export async function gmail(path, { method = "GET", body, query } = {}) {
  const token = await getAccessToken();
  const url = new URL(`https://gmail.googleapis.com/gmail/v1/${path}`);
  for (const [k, v] of Object.entries(query ?? {})) if (v != null) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Gmail API ${path} 失敗：${res.status} ${await res.text()}`);
  return res.json();
}
// ── 直接執行：跑一次性授權 ──────────────────────────────────────────
// `node shared/lib/google_auth.mjs`
// gcp-oauth-setup skill 的最後一步會直接跑這支，學員只需要在跳出來的
// 瀏覽器畫面按「允許」。已經授權過就什麼都不做、直接回報。
if (isMain(import.meta.url)) {
  try {
    if (hasToken()) {
      // 已有 token 時 getAccessToken() 只會沿用或自動 refresh，不會再開瀏覽器
      await getAccessToken();
      const creds = JSON.parse(readFileSync(TOKEN_PATH, "utf8"));
      console.log("這台電腦已經授權過了，不需要重做。");
      console.log(`憑證位置：${TOKEN_PATH}`);
      console.log(`授權範圍：${(creds.scopes ?? []).join(" ")}`);
      console.log(`可自動續期：${creds.refresh_token ? "是" : "否"}`);
    } else {
      await getAccessToken();   // 沒 token → 開瀏覽器等使用者按「允許」
      const creds = JSON.parse(readFileSync(TOKEN_PATH, "utf8"));
      console.log("\n授權完成。");
      console.log(`憑證已寫入：${TOKEN_PATH}`);
      console.log(`授權範圍：${(creds.scopes ?? []).join(" ")}`);
      console.log(`可自動續期：${creds.refresh_token ? "是" : "否"}`);
    }
  } catch (err) {
    // 學員不是工程師，只給看得懂的一行，不要噴 stack trace
    console.error(`\n授權沒有完成：${err.message}`);
    process.exit(1);
  }
}
