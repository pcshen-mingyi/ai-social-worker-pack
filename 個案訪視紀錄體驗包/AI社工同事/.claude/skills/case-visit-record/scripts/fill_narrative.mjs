#!/usr/bin/env node
/**
 * 把訪視紀錄的「敘事內容」（由 Claude 依逐字稿草擬）寫入 docx。
 *
 * 與 fill_identity 分工不同：這裡的欄位本來就會出現在敘事文字裡
 * （訪視日期、地點、主述議題……），來源就是逐字稿，因此不需要對 Claude 保密。
 *
 * 輸入 JSON 的欄位皆為選填，缺的欄位保留範本原樣。
 *
 * 用法：
 *   node fill_narrative.mjs --docx 草稿.docx --out 草稿.docx --json 敘事.json
 */
import { readFileSync } from "node:fs";
import {
  readDocumentXml, saveDocumentXml, tableCellRange, paragraphRanges,
  paraText, setParaText, firstRunRPr, makeParagraph, insertAt,
} from "../../../../shared/lib/docx.mjs";
import { isMain, args } from "../../../../shared/lib/cli.mjs";

const METHOD_OPTIONS = ["電話", "視訊", "實地"];
const BLANK = "＿＿＿＿＿＿＿＿";

/** 對某格第 idx 個段落做一次字串替換 */
function replaceInPara(xml, row, cell, idx, from, to) {
  const [cs, ce] = tableCellRange(xml, row, cell);
  const paras = paragraphRanges(xml, cs, ce);
  if (idx == null || idx >= paras.length) return xml;
  const text = paraText(xml, paras[idx]);
  if (!text.includes(from)) return xml;
  return setParaText(xml, paras[idx], text.replace(from, to));
}

const replaceBlank = (xml, row, cell, idx, label, value) =>
  value ? replaceInPara(xml, row, cell, idx, label + BLANK, label + String(value)) : xml;

const markMethod = (xml, row, cell, idx, method) =>
  METHOD_OPTIONS.includes(method) ? replaceInPara(xml, row, cell, idx, "□" + method, "■" + method) : xml;

const fillVisitNumber = (xml, row, cell, idx, n) =>
  n ? replaceInPara(xml, row, cell, idx, "第　　次", `第 ${n} 次`) : xml;

const lines = (content) =>
  String(content).trim().split("\n").map((l) => l.trim()).filter(Boolean);

/** 找出某格裡文字完全等於 target 的段落索引 */
function indexOfPara(xml, row, cell, target) {
  const [cs, ce] = tableCellRange(xml, row, cell);
  const paras = paragraphRanges(xml, cs, ce);
  for (let i = 0; i < paras.length; i++) {
    if (paraText(xml, paras[i]).trim() === target) return i;
  }
  return null;
}

/**
 * 標題段落的「下一段」放第一行，其餘各行插在再下一段之前。
 * 格式沿用被覆寫那一段原本的 run 格式。
 */
function fillSection(xml, row, cell, heading, content) {
  if (!content) return xml;
  const idx = indexOfPara(xml, row, cell, heading);
  if (idx === null) return xml;
  let ls = lines(content);
  if (!ls.length) return xml;

  let [cs, ce] = tableCellRange(xml, row, cell);
  let paras = paragraphRanges(xml, cs, ce);
  if (idx + 1 >= paras.length) return xml;

  const rPr = firstRunRPr(xml, paras[idx + 1]);
  xml = setParaText(xml, paras[idx + 1], ls[0]);

  if (ls.length > 1) {
    [cs, ce] = tableCellRange(xml, row, cell);
    paras = paragraphRanges(xml, cs, ce);
    // anchor 是「再下一段」的起點；沒有下一段就插在格子結尾前
    const pos = idx + 2 < paras.length ? paras[idx + 2][0] : xml.lastIndexOf("</w:tc>", ce);
    xml = insertAt(xml, pos, ls.slice(1).map((l) => makeParagraph(l, rPr)));
  }
  return xml;
}

/** 處遇計畫：整段都插在標題段落之後，格式沿用標題的 run */
function fillPlanBullet(xml, row, cell, heading, content) {
  if (!content) return xml;
  const idx = indexOfPara(xml, row, cell, heading);
  if (idx === null) return xml;
  const ls = lines(content);
  if (!ls.length) return xml;

  const [cs, ce] = tableCellRange(xml, row, cell);
  const paras = paragraphRanges(xml, cs, ce);
  const rPr = firstRunRPr(xml, paras[idx]);
  const pos = idx + 1 < paras.length ? paras[idx + 1][0] : xml.lastIndexOf("</w:tc>", ce);
  return insertAt(xml, pos, ls.map((l) => makeParagraph(l, rPr)));
}

export function fillNarrative(docxPath, outPath, f) {
  const { entries } = readDocumentXml(docxPath);
  let xml = entries.find((e) => e.name === "word/document.xml").data.toString("utf8");

  // 第 11 列：訪視基本資料與敘事段落
  xml = fillVisitNumber(xml, 11, 0, 0, f.visit_number);
  xml = replaceBlank(xml, 11, 0, 1, "訪視日期：", f.visit_date);
  xml = markMethod(xml, 11, 0, 1, f.visit_method);
  xml = replaceBlank(xml, 11, 0, 2, "訪視地點：", f.visit_location);
  xml = replaceBlank(xml, 11, 0, 2, "訪視人員：", f.visit_staff);
  xml = replaceBlank(xml, 11, 0, 3, "記錄人：", f.recorder);
  xml = replaceBlank(xml, 11, 0, 3, "陪同人員：", f.companion);

  xml = fillSection(xml, 11, 0, "【主述議題】", f.presenting_issue);
  xml = fillSection(xml, 11, 0, "【個案概況】", f.case_overview);
  xml = fillSection(xml, 11, 0, "【各項評估】", f.assessment);
  xml = fillSection(xml, 11, 0, "【需求評估】", f.needs_assessment);

  // 第 13 列：處遇計畫
  xml = fillPlanBullet(xml, 13, 0, "－ 短期目標與行動（1–3 個月）", f.short_term_plan);
  xml = fillPlanBullet(xml, 13, 0, "－ 中長期目標與行動", f.mid_long_term_plan);
  xml = fillPlanBullet(xml, 13, 0, "－ 轉介／資源連結建議", f.referral);
  xml = fillPlanBullet(xml, 13, 0, "－ 下次追蹤時間", f.next_follow_up);

  saveDocumentXml(entries, xml, outPath);
}

if (isMain(import.meta.url)) {
  const a = args();
  for (const k of ["docx", "out", "json"]) {
    if (!a[k]) { console.error(`缺少參數 --${k}`); process.exit(2); }
  }
  fillNarrative(a.docx, a.out, JSON.parse(readFileSync(a.json, "utf8")));
  console.log("已寫入訪視紀錄敘事內容。");
}
