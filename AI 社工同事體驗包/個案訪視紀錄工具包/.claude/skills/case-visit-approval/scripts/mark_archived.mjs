#!/usr/bin/env node
/**
 * 主管核准後：幫 Gmail thread 貼上「已歸檔」標籤並從收件匣封存，
 * 同時把本機的訪視紀錄 docx 以日期格式檔名搬到歸檔資料夾。
 *
 * 檔名規則：{case_id}_訪視紀錄_{visit_date}.docx
 *   例如：CASE-001_訪視紀錄_20260804.docx
 *
 * 用法：
 *   node mark_archived.mjs --thread-id <id> --docx 輸出檔.docx \
 *     --archive-dir 已歸檔/ --case-id CASE-001 --visit-date 20260804
 */
import { mkdirSync, renameSync, copyFileSync, unlinkSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { basename, join } from "node:path";
import { gmail } from "../../../../shared/lib/google_auth.mjs";
import { isMain, args } from "../../../../shared/lib/cli.mjs";
import { PENDING_PATH } from "./send_for_approval.mjs";

const LABEL_NAME = "已歸檔";

async function getOrCreateLabel(name) {
  const { labels = [] } = await gmail("users/me/labels");
  const found = labels.find((l) => l.name === name);
  if (found) return found.id;
  const created = await gmail("users/me/labels", {
    method: "POST",
    body: { name, labelListVisibility: "labelShow", messageListVisibility: "show" },
  });
  return created.id;
}

/** 跨磁碟時 rename 會失敗，退回「複製再刪」 */
function moveFile(from, to) {
  try { renameSync(from, to); }
  catch { copyFileSync(from, to); unlinkSync(from); }
}

if (isMain(import.meta.url)) {
  const a = args();
  for (const k of ["thread-id", "docx", "archive-dir"]) {
    if (!a[k]) { console.error(`缺少參數 --${k}`); process.exit(2); }
  }
  const labelId = await getOrCreateLabel(LABEL_NAME);
  await gmail(`users/me/threads/${a["thread-id"]}/modify`, {
    method: "POST",
    body: { addLabelIds: [labelId], removeLabelIds: ["INBOX"] },
  });

  mkdirSync(a["archive-dir"], { recursive: true });
  const filename = a["case-id"] && a["visit-date"]
    ? `${a["case-id"]}_訪視紀錄_${a["visit-date"]}.docx`
    : basename(a.docx);
  const dest = join(a["archive-dir"], filename);
  moveFile(a.docx, dest);

  if (existsSync(PENDING_PATH)) {
    const pending = JSON.parse(readFileSync(PENDING_PATH, "utf8"));
    const kept = Object.fromEntries(
      Object.entries(pending).filter(([, v]) => v.thread_id !== a["thread-id"])
    );
    writeFileSync(PENDING_PATH, JSON.stringify(kept, null, 2) + "\n", "utf8");
  }

  console.log(`已在 Gmail 貼上「${LABEL_NAME}」標籤並封存。`);
  console.log(`docx 已搬到：${dest}`);
}
