#!/usr/bin/env node
/**
 * 把訪視紀錄 docx 直接附加在信件裡，寄一封確認信給主管（真的寄出，不是草稿）。
 *
 * 簽名檔：自動抓 Gmail 帳號的簽名設定（sendAs 預設值）；未設定則以 --staff-name 署名。
 * 印出：Gmail thread id（後續 check_approval 要用）。
 *
 * 用法：
 *   node send_for_approval.mjs --docx 輸出檔.docx --to 主管信箱 --case-id CASE-001 \
 *     --visit-date 2026/08/04 --staff-name 林社工 \
 *     --summary-situation "…" --summary-needs "…" --summary-plan "…"
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { basename, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { gmail } from "../../../../shared/lib/google_auth.mjs";
import { buildMessage, toRaw, DOCX_MIME } from "../../../../shared/lib/mime.mjs";
import { isMain, args } from "../../../../shared/lib/cli.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const PENDING_PATH = join(HERE, "..", "references", "pending_approvals.json");

const readPending = () =>
  existsSync(PENDING_PATH) ? JSON.parse(readFileSync(PENDING_PATH, "utf8")) : {};
const writePending = (p) =>
  writeFileSync(PENDING_PATH, JSON.stringify(p, null, 2) + "\n", "utf8");

/** 取 Gmail 預設簽名；抓不到就回空字串（呼叫端改用社工姓名） */
async function fetchSignature() {
  try {
    const list = await gmail("users/me/settings/sendAs");
    for (const sa of list.sendAs ?? []) {
      if (sa.isDefault && sa.signature) {
        return sa.signature
          .replace(/<br\s*\/?>/gi, "\n")
          .replace(/<[^>]+>/g, "")
          .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
          .trim();
      }
    }
  } catch { /* 抓不到簽名不該讓寄信失敗 */ }
  return "";
}

export function buildBody({ visitDate, staffName, situation, needs, plan, signature }) {
  return (
    `主任，您好：\n\n` +
    `這是 ${visitDate} ${staffName} 的訪視紀錄，請協助確認（詳見附件）。\n\n` +
    `• 現況摘要：${situation}\n` +
    `• 需求評估摘要：${needs}\n` +
    `• 處遇計畫摘要：${plan}\n\n` +
    `若您確認無誤，再麻煩請核准；如需調整，請不吝給予修改建議，` +
    `我會依建議調整後重新寄出給您確認，謝謝！\n\n` +
    `${signature}`
  );
}

if (isMain(import.meta.url)) {
  const a = args();
  const need = ["docx", "to", "case-id", "visit-date", "staff-name",
                "summary-situation", "summary-needs", "summary-plan"];
  for (const k of need) if (!a[k]) { console.error(`缺少參數 --${k}`); process.exit(2); }

  // 防重複寄信：此案號已有 pending 就直接停止
  const pending = readPending();
  if (pending[a["case-id"]]) {
    console.error(
      `錯誤：${a["case-id"]} 已有待確認的信件（thread: ${pending[a["case-id"]].thread_id}），` +
      `請勿重複寄送。若要重寄，請先手動移除 pending_approvals.json 裡的該筆紀錄。`
    );
    process.exit(1);
  }

  const signature = (await fetchSignature()) || a["staff-name"];
  const subject = `訪視紀錄確認｜${a["case-id"]}｜${a["visit-date"]}`;
  const body = buildBody({
    visitDate: a["visit-date"], staffName: a["staff-name"],
    situation: a["summary-situation"], needs: a["summary-needs"],
    plan: a["summary-plan"], signature,
  });

  const raw = toRaw(buildMessage({
    to: a.to, subject, body,
    attachment: { filename: basename(a.docx), contentType: DOCX_MIME, data: readFileSync(a.docx) },
  }));
  const sent = await gmail("users/me/messages/send", { method: "POST", body: { raw } });

  pending[a["case-id"]] = { thread_id: sent.threadId, to: a.to, visit_date: a["visit-date"] };
  writePending(pending);

  console.log(`已寄出確認信給 ${a.to}（訪視紀錄 docx 已附加在信件中）`);
  console.log(`Gmail thread id：${sent.threadId}`);
}
