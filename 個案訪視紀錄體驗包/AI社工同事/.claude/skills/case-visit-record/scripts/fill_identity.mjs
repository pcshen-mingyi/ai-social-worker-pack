#!/usr/bin/env node
/**
 * 依案號從個案資料表 (xlsx) 查表，直接把身分欄位寫入訪視紀錄 docx。
 *
 * 設計原則（見 SKILL.md）：
 * - 查到的姓名／身分證字號／電話／地址「不會印到 stdout」，呼叫端（Claude）
 *   只看到成功或失敗，看不到欄位內容本身。
 * - 只負責表格上半部的身分欄位，不碰下半部的訪視紀錄敘事欄位。
 *
 * 用法：
 *   node fill_identity.mjs --case-id CASE-001 --data 個案資料表.xlsx \
 *        --docx 案主草稿.docx --out 案主草稿.docx
 */
import { findRow } from "../../../../shared/lib/xlsx.mjs";
import {
  readDocumentXml, saveDocumentXml, tableCellRange,
  paragraphRanges, paraText, setParaText,
} from "../../../../shared/lib/docx.mjs";
import { isMain, args } from "../../../../shared/lib/cli.mjs";

const MARRIAGE_OPTIONS = ["未婚", "同居", "已婚", "離婚", "鰥寡", "分居", "不詳"];
const EDUCATION_OPTIONS = ["不識字", "小學以下", "國小", "國中", "高中職", "大學", "研究所"];
const JOB_OPTIONS = ["商", "工", "農", "漁", "公", "教", "學生", "服務業", "無", "其他"];
const RELIGION_OPTIONS = ["道教", "佛教", "基督教", "天主教", "其他"];
const LIVING_OPTIONS = ["居無定所", "獨居", "與配偶同住", "與子女同住", "與其他人同住"];
const ECONOMY_PREFIXES = ["工作收入每月平均", "子女供給每月平均", "親友供給每月平均"];

/** 直接把整格的第一個段落換成純文字 */
function setCellText(xml, row, cell, text) {
  const [cs, ce] = tableCellRange(xml, row, cell);
  const paras = paragraphRanges(xml, cs, ce);
  if (!paras.length) return xml;
  return setParaText(xml, paras[0], text);
}

/** 找到「家電：」這種標籤段落，把值接在後面 */
function appendAfterLabel(xml, row, cell, label, value) {
  if (!value) return xml;
  const [cs, ce] = tableCellRange(xml, row, cell);
  for (const range of paragraphRanges(xml, cs, ce)) {
    const text = paraText(xml, range);
    const trimmed = text.trim();
    if (trimmed.replace(/[：:]$/, "") === label.replace(/[：:]$/, "") || trimmed === label) {
      return setParaText(xml, range, text + String(value));
    }
  }
  return xml;
}

/** 把選項前面的「□」改成「■」，可在選項後補細節文字 */
function markCheckbox(xml, row, cell, option, extra) {
  const [cs, ce] = tableCellRange(xml, row, cell);
  for (const range of paragraphRanges(xml, cs, ce)) {
    const text = paraText(xml, range);
    const marker = "□" + option;
    const idx = text.indexOf(marker);
    if (idx === -1) continue;
    let next = text.slice(0, idx) + "■" + option + text.slice(idx + marker.length);
    if (extra) {
      let at = idx + 1 + option.length;
      // 範本裡有些選項自帶「：」（例如「其他：」），細節要補在冒號之後
      if (next[at] === "：" || next[at] === ":") at += 1;
      next = next.slice(0, at) + extra + next.slice(at);
    }
    return { xml: setParaText(xml, range, next), ok: true };
  }
  return { xml, ok: false };
}

function fillEconomy(xml, row, cell, value) {
  if (!value) return xml;
  for (const prefix of ECONOMY_PREFIXES) {
    if (!value.includes(prefix)) continue;
    const amount = /(\d[\d,]*)/.exec(value)?.[1] ?? "";
    const [cs, ce] = tableCellRange(xml, row, cell);
    for (const range of paragraphRanges(xml, cs, ce)) {
      const text = paraText(xml, range);
      const marker = "□" + prefix;
      const idx = text.indexOf(marker);
      if (idx === -1) continue;
      const blank = text.indexOf("＿＿＿＿", idx);
      if (blank === -1) continue;
      const next = text.slice(0, idx) + "■" + prefix + amount + text.slice(blank + 4);
      return setParaText(xml, range, next);
    }
  }
  return xml;
}

function fillLiving(xml, row, cell, value) {
  if (!value) return xml;
  const [base, , detail] = splitOnce(value, "：");
  for (const option of LIVING_OPTIONS) {
    if (option === base || (option === "與其他人同住" && base.startsWith("與其他人同住"))) {
      const extra = option === "與其他人同住" && detail ? detail : undefined;
      return markCheckbox(xml, row, cell, option, extra).xml;
    }
  }
  return xml; // 對不上就不硬套，留給人工確認
}

function fillCurrentAddress(xml, row, cell, current) {
  if (!current) return xml;
  if (current.trim() === "同上") return markCheckbox(xml, row, cell, "同上").xml;
  const [base, , detail] = splitOnce(current, "：");
  if (base.trim() === "其他") return markCheckbox(xml, row, cell, "其他", detail).xml;
  return markCheckbox(xml, row, cell, "其他", current).xml;
}

const splitOnce = (s, sep) => {
  const i = s.indexOf(sep);
  return i === -1 ? [s, "", ""] : [s.slice(0, i), sep, s.slice(i + sep.length)];
};

export function fillIdentity(docxPath, outPath, rec) {
  const { entries } = readDocumentXml(docxPath);
  let xml = entries.find((e) => e.name === "word/document.xml").data.toString("utf8");
  const v = (k) => String(rec[k] ?? "");

  xml = setCellText(xml, 0, 1, v("姓名"));
  xml = setCellText(xml, 0, 3, v("出生年月日"));
  xml = setCellText(xml, 1, 1, v("身分證字號"));
  xml = appendAfterLabel(xml, 1, 3, "家電：", rec["家電"]);
  xml = appendAfterLabel(xml, 1, 3, "手機：", rec["手機"]);

  if (["男", "女"].includes(v("性別"))) xml = markCheckbox(xml, 2, 1, v("性別")).xml;
  if (MARRIAGE_OPTIONS.includes(v("婚姻狀況"))) xml = markCheckbox(xml, 2, 3, v("婚姻狀況")).xml;

  xml = setCellText(xml, 3, 1, v("戶籍地址"));
  xml = fillCurrentAddress(xml, 4, 1, v("現住地址"));

  if (EDUCATION_OPTIONS.includes(v("教育程度"))) xml = markCheckbox(xml, 5, 1, v("教育程度")).xml;
  xml = fillLiving(xml, 6, 1, v("居住狀況"));

  const job = v("職業");
  if (JOB_OPTIONS.includes(job)) xml = markCheckbox(xml, 7, 1, job).xml;
  else if (job) xml = markCheckbox(xml, 7, 1, "其他", job).xml;

  xml = fillEconomy(xml, 8, 1, v("經濟狀況"));

  const religion = v("宗教信仰");
  if (RELIGION_OPTIONS.includes(religion)) xml = markCheckbox(xml, 9, 1, religion).xml;
  else if (religion) xml = markCheckbox(xml, 9, 1, "其他", religion).xml;

  saveDocumentXml(entries, xml, outPath);
}

if (isMain(import.meta.url)) {
  const a = args();
  for (const k of ["case-id", "data", "docx", "out"]) {
    if (!a[k]) { console.error(`缺少參數 --${k}`); process.exit(2); }
  }
  const rec = findRow(a.data, "案號", a["case-id"]);
  if (!rec) { console.error(`錯誤：在資料表中找不到案號 ${a["case-id"]}`); process.exit(1); }
  fillIdentity(a.docx, a.out, rec);
  // 刻意不印出任何欄位內容，只回報成功，避免身分資料經過對話紀錄
  console.log(`已成功寫入案號 ${a["case-id"]} 的身分欄位。`);
}
