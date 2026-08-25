/**
 * xlsx 唯讀（取代 openpyxl 這裡實際用到的部分：讀第一個工作表當成表格）。
 *
 * xlsx 也是 zip。儲存格的值有兩種存法：
 *   t="s"        → <v> 是 sharedStrings 的索引
 *   t="inlineStr"→ 值直接在 <is><t> 裡
 *   其他          → <v> 就是字面值（數字或日期序號）
 *
 * 這個工具包的示範資料全部是共享字串，但三種都處理，避免有人換資料就壞掉。
 */
import { readFileSync } from "node:fs";
import { readZip } from "./zip.mjs";

const unescapeXml = (s) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
   .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
   .replace(/&amp;/g, "&");

const stripTags = (s) => unescapeXml(s.replace(/<[^>]+>/g, ""));

/** 讀第一個工作表，回傳 { headers, rows }（rows 是物件陣列） */
export function readSheet(xlsxPath) {
  const entries = readZip(readFileSync(xlsxPath));
  const find = (re) => entries.find((e) => re.test(e.name));

  const ssEntry = find(/xl\/sharedStrings\.xml$/);
  const shared = ssEntry
    ? [...ssEntry.data.toString("utf8").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => stripTags(m[1]))
    : [];

  const sheet = find(/xl\/worksheets\/sheet1\.xml$/);
  if (!sheet) throw new Error("找不到 xl/worksheets/sheet1.xml");
  const xml = sheet.data.toString("utf8");

  const grid = [];
  for (const rm of xml.matchAll(/<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    const rowIdx = +rm[1] - 1;
    const cells = [];
    // 同時處理 <c .../>（空儲存格）與 <c ...>…</c>。
    // 不處理自閉合的話，非貪婪比對會跨過空格，把後面儲存格的內容算到前一格——
    // 實際踩過：某列的「家電」拿到了共享字串的索引 85。
    for (const cm of rm[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1] ?? "";
      const inner = cm[2] ?? "";
      const ref = /r="([A-Z]+)\d+"/.exec(attrs)?.[1];
      if (!ref) continue;
      const col = colToIndex(ref);
      let value = "";
      const t = /t="([^"]+)"/.exec(attrs)?.[1];
      if (t === "s") {
        const i = +stripTags(/<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? "");
        value = shared[i] ?? "";
      } else if (t === "inlineStr") {
        value = stripTags(/<is>([\s\S]*?)<\/is>/.exec(inner)?.[1] ?? "");
      } else {
        value = stripTags(/<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? "");
      }
      cells[col] = value;
    }
    grid[rowIdx] = cells;
  }

  const headers = (grid[0] ?? []).map((h) => (h ?? "").trim());
  const rows = [];
  for (let r = 1; r < grid.length; r++) {
    if (!grid[r]) continue;
    const rec = {};
    headers.forEach((h, i) => { if (h) rec[h] = grid[r][i] ?? ""; });
    rows.push(rec);
  }
  return { headers, rows };
}

const colToIndex = (letters) => {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

/** 依欄位值找一列（例如用案號查個案） */
export function findRow(xlsxPath, key, value) {
  const { rows } = readSheet(xlsxPath);
  return rows.find((r) => String(r[key] ?? "").trim() === String(value).trim()) ?? null;
}
