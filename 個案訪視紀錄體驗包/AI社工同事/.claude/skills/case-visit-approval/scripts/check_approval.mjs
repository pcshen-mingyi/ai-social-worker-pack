#!/usr/bin/env node
/**
 * 查詢主管是否已回覆確認信。印出我們寄出之後的所有回覆內容，
 * 交給 Claude 判斷是「核准」還是「退件要求修改」——這支腳本不自己猜。
 *
 * 用法：
 *   node check_approval.mjs --thread-id <thread id>
 *   node check_approval.mjs --auto      # 只在有 pending 的案件時才查
 */
import { readFileSync, existsSync } from "node:fs";
import { gmail } from "../../../../shared/lib/google_auth.mjs";
import { isMain, args } from "../../../../shared/lib/cli.mjs";
import { PENDING_PATH } from "./send_for_approval.mjs";

const b64urlDecode = (s) =>
  Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");

/** 遞迴找出第一段 text/plain */
export function extractPlainText(payload) {
  if (payload?.mimeType === "text/plain" && payload.body?.data) {
    return b64urlDecode(payload.body.data);
  }
  for (const part of payload?.parts ?? []) {
    const t = extractPlainText(part);
    if (t) return t;
  }
  return "";
}

/** 回傳回覆內容陣列；只有原信（沒人回覆）時回 null */
export async function checkThread(threadId) {
  const thread = await gmail(`users/me/threads/${threadId}`, { query: { format: "full" } });
  const msgs = thread.messages ?? [];
  if (msgs.length <= 1) return { replies: null, total: msgs.length };
  const replies = msgs.slice(1).map((msg, i) => {
    const h = Object.fromEntries((msg.payload.headers ?? []).map((x) => [x.name, x.value]));
    const text = extractPlainText(msg.payload).trim();
    return `--- 回覆 ${i + 1}（來自 ${h.From ?? "未知"}，${h.Date ?? ""}）---\n${text}`;
  });
  return { replies, total: msgs.length };
}

if (isMain(import.meta.url)) {
  const a = args();
  if (a.auto) {
    if (!existsSync(PENDING_PATH)) process.exit(0);
    const pending = JSON.parse(readFileSync(PENDING_PATH, "utf8"));
    if (!Object.keys(pending).length) process.exit(0);
    for (const [caseId, info] of Object.entries(pending)) {
      const { replies } = await checkThread(info.thread_id);
      if (replies) {
        console.log(`【${caseId}】訪視紀錄確認信有新回覆（thread: ${info.thread_id}）：\n`);
        for (const r of replies) console.log(r + "\n");
      }
      // 沒有回覆就安靜略過
    }
  } else {
    if (!a["thread-id"]) { console.error("請提供 --thread-id 或使用 --auto"); process.exit(2); }
    const { replies, total } = await checkThread(a["thread-id"]);
    if (!replies) console.log("目前這個 thread 還沒有新回覆。");
    else {
      console.log(`這個 thread 共有 ${total} 則訊息，第一則之後為回覆：\n`);
      for (const r of replies) console.log(r + "\n");
    }
  }
}
