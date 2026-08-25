#!/usr/bin/env node
/**
 * 依案號查出案主的年齡區間，判斷家系圖要往上／往下畫幾代。
 *
 * 隱私設計與 fill_identity 相同：只回報「年齡區間 + 建議世代範圍」，
 * **不會印出出生年月日本身**。
 *
 * 用法：
 *   node classify_scope.mjs --case-id CASE-001 --data 個案資料表.xlsx [--today 2026-08-20]
 *
 * 查不到案號時（資料不在這份表裡、或用互動訪談模式）會回報找不到，
 * 這時改用逐字稿裡的年齡線索自行判斷即可，不必堅持查表。
 */
import { findRow } from "../../../../shared/lib/xlsx.mjs";
import { isMain, args } from "../../../../shared/lib/cli.mjs";

export function parseDob(value) {
  const m = /(\d{4})[/\-](\d{1,2})[/\-](\d{1,2})/.exec(String(value ?? "").trim());
  if (!m) return null;
  return { y: +m[1], m: +m[2], d: +m[3] };
}

export function classify(dob, today) {
  let age = today.y - dob.y;
  if (today.m < dob.m || (today.m === dob.m && today.d < dob.d)) age -= 1;
  if (age < 18) return ["幼兒青少年案主", "up2", "以案主為中心，往上兩代（案父母、案祖父母／外祖父母）"];
  if (age < 65) return ["中壯年案主", "updown1", "以案主為中心，往上下各一代（案父母、案子女）"];
  return ["老年案主", "down2", "以案主為中心，往下兩代（案子女、案孫子女／外孫子女）"];
}

if (isMain(import.meta.url)) {
  const a = args();
  for (const k of ["case-id", "data"]) {
    if (!a[k]) { console.error(`缺少參數 --${k}`); process.exit(2); }
  }
  const rec = findRow(a.data, "案號", a["case-id"]);
  if (!rec) { console.error(`錯誤：在資料表中找不到案號 ${a["case-id"]}`); process.exit(1); }
  const dob = parseDob(rec["出生年月日"]);
  if (!dob) {
    console.error("錯誤：出生年月日格式無法辨識，請改用逐字稿裡的年齡線索自行判斷世代範圍。");
    process.exit(1);
  }
  const now = a.today ? parseDob(a.today.replace(/-/g, "/")) : (() => {
    const d = new Date();
    return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() };
  })();
  const [label, scope, note] = classify(dob, now);
  console.log(`${label}｜scope=${scope}｜${note}`);
}
