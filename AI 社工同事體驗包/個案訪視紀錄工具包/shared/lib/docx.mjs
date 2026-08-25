/**
 * docx 讀寫（取代 python-docx 這個工具包實際用到的功能）。
 *
 * docx 就是一個 zip，裡面主要是 word/document.xml。這裡不引入 XML 解析器，
 * 改用「找到目標元素的範圍再做字串手術」——因為我們只動自己產的範本，
 * 結構已知且固定，這樣比引入一個完整 DOM 更小也更好預測。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { readZip, writeZip } from "./zip.mjs";

const EMU_PER_INCH = 914400;

/**
 * 找出從 startIdx（指向 <tag）開始的元素結束位置，正確處理嵌套與自閉合。
 *
 * ⚠️ 起點本身就是自閉合（例如空段落 `<w:p .../>`）時必須立刻結束。
 * 不處理的話會繼續去找 `</w:p>`，找到的是**下一格的**結束標籤，範圍就跨格了——
 * 實際踩過：姓名被寫進隔壁的「出生年月日」格。
 */
export function matchEnd(xml, startIdx, tag) {
  const openTag = `<${tag}`, closeTag = `</${tag}>`;
  const firstGt = xml.indexOf(">", startIdx);
  if (firstGt !== -1 && xml[firstGt - 1] === "/") return firstGt + 1; // 自閉合
  let depth = 0, i = startIdx;
  while (i < xml.length) {
    const nO = xml.indexOf(openTag, i);
    const nC = xml.indexOf(closeTag, i);
    if (nC === -1) return -1;
    if (nO !== -1 && nO < nC) {
      const ch = xml[nO + openTag.length];
      if (ch === " " || ch === ">" || ch === "/") {
        const gt = xml.indexOf(">", nO);
        if (xml[gt - 1] === "/") { i = gt + 1; continue; } // 自閉合，不算一層
        depth++; i = gt + 1; continue;
      }
      i = nO + openTag.length; continue;                    // 只是名稱前綴相同
    }
    depth--;
    if (depth === 0) return nC + closeTag.length;
    i = nC + closeTag.length;
  }
  return -1;
}

/** 列出某段 XML 裡所有「最外層」的指定元素範圍 */
export function childRanges(xml, from, to, tag) {
  const out = [];
  let i = from;
  while (i < to) {
    const s = xml.indexOf(`<${tag}`, i);
    if (s === -1 || s >= to) break;
    const ch = xml[s + tag.length + 1];
    if (ch !== " " && ch !== ">" && ch !== "/") { i = s + tag.length + 1; continue; }
    const e = matchEnd(xml, s, tag);
    if (e === -1) break;
    out.push([s, e]);
    i = e;
  }
  return out;
}

/**
 * 取第一個表格裡第 rowIdx 列、第 cellIdx 格的範圍。
 *
 * ⚠️ cellIdx 是**邏輯欄位索引**，與 python-docx 的 row.cells 一致：
 * 橫向合併的格子（<w:gridSpan w:val="N"/>）會佔用 N 個索引。
 * 直接數實體 <w:tc> 的話，只要表格有合併格，索引就會整列往左偏——
 * 實際踩過：姓名寫到了「出生年月日」那一格。
 */
export function tableCellRange(xml, rowIdx, cellIdx = 0) {
  const tblStart = xml.indexOf("<w:tbl>");
  if (tblStart === -1) throw new Error("document.xml 裡找不到表格");
  const tblEnd = matchEnd(xml, tblStart, "w:tbl");
  const rows = childRanges(xml, tblStart, tblEnd, "w:tr");
  if (rowIdx >= rows.length) throw new Error(`表格只有 ${rows.length} 列，取不到第 ${rowIdx} 列`);
  const [rs, re] = rows[rowIdx];
  const cells = childRanges(xml, rs, re, "w:tc");

  let logical = 0;
  for (const range of cells) {
    const span = gridSpan(xml, range);
    if (cellIdx < logical + span) return range;
    logical += span;
  }
  throw new Error(`第 ${rowIdx} 列只有 ${logical} 個邏輯欄位，取不到第 ${cellIdx} 格`);
}

/** 這一格橫跨幾個欄位（沒宣告就是 1） */
function gridSpan(xml, [s, e]) {
  const head = xml.slice(s, Math.min(e, s + 600));
  const m = /<w:gridSpan\s+w:val="(\d+)"\s*\/>/.exec(head);
  return m ? Math.max(1, +m[1]) : 1;
}

const pngSize = (buf) => ({ w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) });

/**
 * 把圖片插進第一個表格指定格子的最後（對應 python-docx 的
 * tables[0].rows[15].cells[0].add_paragraph() + run.add_picture(width=Inches(6))）
 */
export function embedImageIntoDocx(docxPath, imgPath, outPath, { row = 15, cell = 0, widthInch = 6 } = {}) {
  const entries = readZip(readFileSync(docxPath));
  const img = readFileSync(imgPath);
  const { w, h } = pngSize(img);
  const cx = Math.round(widthInch * EMU_PER_INCH);
  const cy = Math.round((cx * h) / w);

  const get = (name) => entries.find((e) => e.name === name);
  const mediaName = `media/${basename(imgPath)}`;

  // 1) 關聯：給圖片一個沒被用過的 rId
  const rels = get("word/_rels/document.xml.rels");
  const used = [...rels.data.toString("utf8").matchAll(/Id="rId(\d+)"/g)].map((m) => +m[1]);
  const rid = `rId${Math.max(0, ...used) + 1}`;
  rels.data = Buffer.from(
    rels.data.toString("utf8").replace(
      "</Relationships>",
      `<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${mediaName}"/></Relationships>`
    ),
    "utf8"
  );

  // 2) [Content_Types]：沒宣告 png 的話 Word 會拒絕開檔
  const ct = get("[Content_Types].xml");
  let ctXml = ct.data.toString("utf8");
  if (!ctXml.includes('Extension="png"')) {
    ctXml = ctXml.replace("<Types", "<Types").replace(
      /(<Types[^>]*>)/,
      `$1<Default Extension="png" ContentType="image/png"/>`
    );
    ct.data = Buffer.from(ctXml, "utf8");
  }

  // 3) document.xml：在目標格子最後插一段含圖片的段落
  const docEntry = get("word/document.xml");
  const xml = docEntry.data.toString("utf8");
  const [, cellEnd] = tableCellRange(xml, row, cell);
  const insertAt = xml.lastIndexOf("</w:tc>", cellEnd);
  const drawing =
    `<w:p><w:r><w:drawing>` +
    `<wp:inline distT="0" distB="0" distL="0" distR="0">` +
    `<wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="1001" name="genogram"/>` +
    `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">` +
    `<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:nvPicPr><pic:cNvPr id="0" name="${basename(imgPath)}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="${rid}"/>` +
    `<a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
    `</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
  docEntry.data = Buffer.from(xml.slice(0, insertAt) + drawing + xml.slice(insertAt), "utf8");

  // 4) 圖片本體
  entries.push({ name: `word/${mediaName}`, data: img });

  writeFileSync(outPath, writeZip(entries));
  return { rid, cx, cy };
}

export function readDocumentXml(docxPath) {
  const entries = readZip(readFileSync(docxPath));
  return { entries, xml: entries.find((e) => e.name === "word/document.xml").data.toString("utf8") };
}

export function saveDocumentXml(entries, xml, outPath) {
  entries.find((e) => e.name === "word/document.xml").data = Buffer.from(xml, "utf8");
  writeFileSync(outPath, writeZip(entries));
}

// ── 段落文字讀寫（取代 python-docx 的 paragraph.runs 操作）──
//
// 一個段落長這樣：<w:p>…<w:r><w:t>文字</w:t></w:r><w:r><w:t>更多</w:t></w:r>…</w:p>
// 讀文字＝把所有 <w:t> 串起來；寫文字＝把全部放進第一個 <w:t>、其餘清空。
// 這與 python-docx 的 set_para_text 行為一致，會保留段落與 run 的格式。

const escapeXml = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const unescapeXml = (s) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
   .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
   .replace(/&amp;/g, "&");

/** 某個範圍內所有最外層段落的範圍 */
export const paragraphRanges = (xml, from, to) => childRanges(xml, from, to, "w:p");

/** 讀段落文字 */
export function paraText(xml, [s, e]) {
  const seg = xml.slice(s, e);
  return [...seg.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
    .map((m) => unescapeXml(m[1])).join("");
}

/**
 * 寫段落文字，回傳新的整份 xml。
 * 段落若原本沒有任何 run（範本裡「留白待填」的格子就是這種），補一個進去。
 */
export function setParaText(xml, [s, e], text) {
  let seg = xml.slice(s, e);

  // 自閉合的空段落 <w:p .../> 要先展開成成對標籤，否則插不進 run
  // （範本裡「留白待填」的格子就是這種寫法）
  if (/\/>\s*$/.test(seg) && !seg.includes("</w:p>")) {
    seg = seg.replace(/\/>\s*$/, "></w:p>");
  }

  const ts = [...seg.matchAll(/<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>/g)];
  if (!ts.length) {
    const insertAt = seg.lastIndexOf("</w:p>");
    // xml:space="preserve" 一定要加，否則前後空白會被 Word 吃掉
    seg = seg.slice(0, insertAt) +
      `<w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>` +
      seg.slice(insertAt);
  } else {
    let out = "", last = 0;
    ts.forEach((m, i) => {
      out += seg.slice(last, m.index);
      out += i === 0
        ? `<w:t xml:space="preserve">${escapeXml(text)}</w:t>`
        : `<w:t xml:space="preserve"></w:t>`;
      last = m.index + m[0].length;
    });
    seg = out + seg.slice(last);
  }
  return xml.slice(0, s) + seg + xml.slice(e);
}

/** 在第一個表格的某一格裡，對「符合條件的第一個段落」做文字替換 */
export function editCellParagraph(xml, row, cell, pick) {
  const [cs, ce] = tableCellRange(xml, row, cell);
  const paras = paragraphRanges(xml, cs, ce);
  for (const range of paras) {
    const text = paraText(xml, range);
    const next = pick(text);
    if (next !== null && next !== undefined && next !== false) {
      return { xml: setParaText(xml, range, next), changed: true };
    }
  }
  return { xml, changed: false };
}

/**
 * 取段落第一個 run 的格式（<w:rPr>…</w:rPr>）。
 * 新插入的段落要沿用它，否則會套到 Word 預設樣式，字型跟範本不一致。
 */
export function firstRunRPr(xml, [s, e]) {
  const seg = xml.slice(s, e);
  const rs = seg.indexOf("<w:r>");
  if (rs === -1) return "";
  const rEnd = matchEnd(seg, rs, "w:r");
  const run = seg.slice(rs, rEnd === -1 ? undefined : rEnd);
  const ps = run.indexOf("<w:rPr>");
  if (ps === -1) return "";
  const pe = matchEnd(run, ps, "w:rPr");
  return pe === -1 ? "" : run.slice(ps, pe);
}

/** 組一個新段落；rPr 沿用參考 run 的格式 */
export function makeParagraph(text, rPr = "") {
  const esc = String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<w:p><w:r>${rPr}<w:t xml:space="preserve">${esc}</w:t></w:r></w:p>`;
}

/** 在指定位置插入若干段落（位置通常是某個段落的起點，或格子的 </w:tc> 之前） */
export const insertAt = (xml, pos, chunks) =>
  xml.slice(0, pos) + chunks.join("") + xml.slice(pos);

/** 某格裡「文字完全等於 target」的段落索引 */
export function findParaIndex(xml, row, cell, target) {
  const [cs, ce] = tableCellRange(xml, row, cell);
  const paras = paragraphRanges(xml, cs, ce);
  for (let i = 0; i < paras.length; i++) {
    if (paraText(xml, paras[i]).trim() === target) return i;
  }
  return null;
}

/** 取某格的段落範圍清單（每次呼叫都重新掃，避免用到過期的位移） */
export function cellParas(xml, row, cell) {
  const [cs, ce] = tableCellRange(xml, row, cell);
  return { cellEnd: ce, paras: paragraphRanges(xml, cs, ce) };
}
