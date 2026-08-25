#!/usr/bin/env node
/**
 * 把已確認的家庭成員／關係 JSON 畫成家系圖 PNG。
 *
 * 符號系統採標準家系圖規範（McGoldrick/Gerson），純黑白線條——關係類型一律靠
 * 線型／線條數量／斜線記號區分，不用顏色。詳見 references/notation-legend.md。
 *
 * 用法：
 *   node render_genogram.mjs --data family.json --png 家系圖.png
 *   node render_genogram.mjs --data family.json --png 家系圖.png \
 *        --embed-docx 輸出.docx --out 輸出.docx
 *
 * 這一版不需要安裝任何東西：字型與繪圖都在工具包裡（見 shared/assets/README.md）。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { parse as parseFont } from "../../../../shared/vendor/opentype.min.mjs";
import {
  makeCanvas, fill, drawText, encodePNG,
  rectOutline, circleOutline, line, polyline, dashedLine, polygon,
} from "../../../../shared/lib/raster.mjs";
import { FONT_PATH } from "../../../../shared/lib/config.mjs";
import { isMain, args } from "../../../../shared/lib/cli.mjs";
import {
  layout, memberHalfSize, STATUS_STYLE, QUALITY_STYLE,
  GEN_GAP, SYMBOL_SIZE, LABEL_ZONE_TOP, LABEL_ZONE_BOTTOM, IP_SCALE,
} from "./genogram_layout.mjs";
import { embedImageIntoDocx } from "../../../../shared/lib/docx.mjs";

const SCALE = 110;      // 每「格」多少像素（決定成圖大小；原本 matplotlib 是 dpi=200）
const PAD = 70;         // 邊界留白（像素）
const LABEL_PX = 20;    // 姓名文字大小（像素）
const LW = 1.6;         // 一般線寬
const LW_BOLD = 2.6;    // 索引個案的框線

/** 資料座標 → 像素座標。matplotlib 的 y 往上，圖片的 y 往下，所以要翻轉。 */
function makeMapper(xPos, yPos) {
  const xs = Object.values(xPos), ys = Object.values(yPos);
  const minX = Math.min(...xs) - 1.8, maxX = Math.max(...xs) + 1.8;
  const minY = Math.min(...ys) - 1.5, maxY = Math.max(...ys) + 1.5;
  const w = Math.round((maxX - minX) * SCALE) + PAD * 2;
  const h = Math.round((maxY - minY) * SCALE) + PAD * 2;
  return {
    w, h,
    X: (x) => PAD + (x - minX) * SCALE,
    Y: (y) => PAD + (maxY - y) * SCALE,
    S: (v) => v * SCALE,
  };
}

/**
 * 垂直單位向量。**注意符號與 matplotlib 版相反**：
 * matplotlib 的 y 往上，影像座標的 y 往下，同一條公式算出來的方向在視覺上
 * 是鏡像的。情感關係線要畫在婚姻線的同一側（上方），所以這裡取負。
 */
const perpUnit = (p1, p2) => {
  const dx = p2.x - p1.x, dy = p2.y - p1.y, L = Math.hypot(dx, dy) || 1;
  return { x: dy / L, y: -dx / L };
};
const dirUnit = (p1, p2) => {
  const dx = p2.x - p1.x, dy = p2.y - p1.y, L = Math.hypot(dx, dy) || 1;
  return { x: dx / L, y: dy / L };
};

function drawParallel(cv, p1, p2, n, gap, style, lw) {
  const pp = perpUnit(p1, p2), total = ((n - 1) * gap) / 2;
  for (let i = 0; i < n; i++) {
    const off = i * gap - total;
    const a = { x: p1.x + pp.x * off, y: p1.y + pp.y * off };
    const b = { x: p2.x + pp.x * off, y: p2.y + pp.y * off };
    fill(cv, style === "dotted" ? dashedLine(a.x, a.y, b.x, b.y, lw, 5, 5)
                                : line(a.x, a.y, b.x, b.y, lw));
  }
}

function drawZigzag(cv, p1, p2, n = 8, amp = 7, lw = 1.6) {
  const pp = perpUnit(p1, p2), pts = [];
  for (let i = 0; i <= n; i++) {
    const x = p1.x + ((p2.x - p1.x) * i) / n, y = p1.y + ((p2.y - p1.y) * i) / n;
    const sign = i % 2 === 0 ? 1 : -1, edge = i === 0 || i === n ? 0 : 1;
    pts.push({ x: x + pp.x * amp * sign * edge, y: y + pp.y * amp * sign * edge });
  }
  fill(cv, polyline(pts, lw));
}

function drawCutoff(cv, p1, p2, lw = 1.6) {
  fill(cv, line(p1.x, p1.y, p2.x, p2.y, lw));
  const pp = perpUnit(p1, p2);
  for (const frac of [0.42, 0.58]) {
    const cx = p1.x + (p2.x - p1.x) * frac, cy = p1.y + (p2.y - p1.y) * frac;
    fill(cv, line(cx - pp.x * 15, cy - pp.y * 15, cx + pp.x * 15, cy + pp.y * 15, lw));
  }
}

/** 線段中點的斜線：分居 1 條、離婚 2 條 */
function drawSlashes(cv, p1, p2, n) {
  if (n <= 0) return;
  const pp = perpUnit(p1, p2), dv = dirUnit(p1, p2), spacing = 10;
  const start = (-(n - 1) * spacing) / 2;
  const cx = (p1.x + p2.x) / 2, cy = (p1.y + p2.y) / 2;
  for (let i = 0; i < n; i++) {
    const off = start + i * spacing;
    const bx = cx + dv.x * off, by = cy + dv.y * off;
    fill(cv, line(bx - pp.x * 18 - dv.x * 6, by - pp.y * 18 - dv.y * 6,
                  bx + pp.x * 18 + dv.x * 6, by + pp.y * 18 + dv.y * 6, 1.6));
  }
}

/** 同居承諾關係：線段中點下方一個朝下的小三角形 */
function drawTriangle(cv, p1, p2, size = 10) {
  const pp = perpUnit(p1, p2), dv = dirUnit(p1, p2);
  const cx = (p1.x + p2.x) / 2, cy = (p1.y + p2.y) / 2;
  fill(cv, polygon([
    { x: cx - dv.x * size, y: cy - dv.y * size },
    { x: cx + pp.x * size * 1.6, y: cy + pp.y * size * 1.6 },
    { x: cx + dv.x * size, y: cy + dv.y * size },
  ]));
}

function drawStatusAndQuality(cv, p1, p2, status, quality) {
  const baseGap = 18;
  let slot = 0;
  if (status && STATUS_STYLE[status]) {
    const st = STATUS_STYLE[status];
    fill(cv, line(p1.x, p1.y, p2.x, p2.y, LW));
    if (st.slashes) drawSlashes(cv, p1, p2, st.slashes);
    if (st.triangle) drawTriangle(cv, p1, p2);
    slot = 1;
  }
  if (quality && QUALITY_STYLE[quality]) {
    const st = QUALITY_STYLE[quality], pp = perpUnit(p1, p2), off = baseGap * (slot + 1);
    const q1 = { x: p1.x + pp.x * off, y: p1.y + pp.y * off };
    const q2 = { x: p2.x + pp.x * off, y: p2.y + pp.y * off };
    const mode = st.mode ?? "parallel";
    if (mode === "zigzag") drawZigzag(cv, q1, q2);
    else if (mode === "zigzag_double") { drawParallel(cv, q1, q2, 2, 7, "-", 1.4); drawZigzag(cv, q1, q2); }
    else if (mode === "cutoff") drawCutoff(cv, q1, q2);
    else drawParallel(cv, q1, q2, st.lines ?? 1, 7, st.linestyle ?? "-", 1.4);
  }
}

export function draw(members, relations, outPng) {
  const byId = Object.fromEntries(members.map((m) => [m.id, m]));
  const { xPos, yPos } = layout(members, relations);
  const M = makeMapper(xPos, yPos);
  const cv = makeCanvas(M.w, M.h);
  const fontBuf = readFileSync(FONT_PATH);
  const font = parseFont(fontBuf.buffer.slice(fontBuf.byteOffset, fontBuf.byteOffset + fontBuf.byteLength));
  const missing = [];

  // ── 關係線 ──
  for (const r of relations) {
    const { a, b } = r;
    if (!(a in xPos) || !(b in xPos)) continue;
    const p1 = { x: M.X(xPos[a]), y: M.Y(yPos[a]) };
    const p2 = { x: M.X(xPos[b]), y: M.Y(yPos[b]) };
    if (r.type in STATUS_STYLE || r.quality) {
      drawStatusAndQuality(cv, p1, p2, r.type in STATUS_STYLE ? r.type : null, r.quality);
    } else if (r.type === "parent") {
      const parentHalf = M.S(memberHalfSize(byId[a]));
      const childHalf = M.S(memberHalfSize(byId[b]));
      const scaleP = byId[a].is_index ? IP_SCALE : 1;
      const zoneTopP = M.S(LABEL_ZONE_TOP * scaleP);
      const zoneBottomP = M.S(LABEL_ZONE_BOTTOM * scaleP);
      const midY = M.Y(yPos[a] - GEN_GAP / 2);
      // 線先從符號下緣走到姓名文字區塊上緣，跳過文字，再從文字下緣繼續往下，
      // 避免壓到姓名（y 往下遞增，所以「往下」是加）
      fill(cv, line(p1.x, p1.y + parentHalf, p1.x, p1.y + zoneTopP, 1.4));
      fill(cv, line(p1.x, p1.y + zoneBottomP, p1.x, midY, 1.4));
      fill(cv, line(p1.x, midY, p2.x, midY, 1.4));
      fill(cv, line(p2.x, midY, p2.x, p2.y - childHalf, 1.4));
    }
  }

  // ── 成員符號與姓名 ──
  for (const m of members) {
    const cx = M.X(xPos[m.id]), cy = M.Y(yPos[m.id]);
    const isIndex = !!m.is_index;
    const size = M.S(SYMBOL_SIZE * (isIndex ? IP_SCALE : 1));
    const lw = isIndex ? LW_BOLD : LW;
    const borderN = isIndex ? 2 : 1;   // 索引個案：同心雙線框
    const inset = M.S(0.05);

    if (m.gender === "female") {
      for (let i = 0; i < borderN; i++) {
        fill(cv, circleOutline(cx, cy, size / 2 - i * inset, lw));
      }
    } else {
      for (let i = 0; i < borderN; i++) {
        const o = i * inset;
        fill(cv, rectOutline(cx - size / 2 + o, cy - size / 2 + o, size - 2 * o, size - 2 * o, lw));
      }
      // 身障標記：男性方形右半邊塗黑
      if (m.disabled) {
        fill(cv, polygon([
          { x: cx, y: cy - size / 2 + inset }, { x: cx + size / 2 - inset, y: cy - size / 2 + inset },
          { x: cx + size / 2 - inset, y: cy + size / 2 - inset }, { x: cx, y: cy + size / 2 - inset },
        ]));
      }
    }

    if (m.deceased) {
      const h = (size / 2) * 0.92;
      fill(cv, line(cx - h, cy - h, cx + h, cy + h, 1.8));
      fill(cv, line(cx - h, cy + h, cx + h, cy - h, 1.8));
    }

    let label = m.name ?? "";
    const notes = [];
    if (m.note) notes.push(m.note);
    if (m.twin_group) notes.push(m.identical_twin ? "同卵雙胞胎" : "雙胞胎");
    if (notes.length) label = `${label}（${notes.join("、")}）`;

    // 姓名置中於符號下方。Python 版用 va="top"（文字上緣對齊），
    // 而 drawText 的 y 是基線，所以要再往下加一個字高的上升部
    const probe = measure(font, label, LABEL_PX);
    const labelTop = cy + size / 2 + M.S(LABEL_ZONE_TOP - SYMBOL_SIZE / 2);
    const labelY = labelTop + LABEL_PX * 0.82;
    const res = drawText(cv, font, label, cx - probe / 2, labelY, LABEL_PX);
    missing.push(...res.missing);
  }

  writeFileSync(outPng, encodePNG(cv));
  return { width: M.w, height: M.h, missing: [...new Set(missing)] };
}

function measure(font, text, size) {
  let w = 0;
  for (const ch of text) {
    const g = font.charToGlyph(ch);
    w += (g.advanceWidth / font.unitsPerEm) * size || size * 0.9;
  }
  return w;
}

if (isMain(import.meta.url)) {
  const a = args();
  if (!a.data || !a.png) {
    console.error("用法：node render_genogram.mjs --data family.json --png 家系圖.png [--embed-docx 檔.docx --out 輸出.docx]");
    process.exit(2);
  }
  const payload = JSON.parse(readFileSync(a.data, "utf8"));
  const r = draw(payload.members, payload.relations, a.png);
  console.log(`已產出家系圖：${a.png}（${r.width}×${r.height}）`);
  if (r.missing.length) {
    console.log(`⚠️ 內附字型缺少這些字，圖上會顯示空心方框：${r.missing.join("")}`);
    console.log("   （子集字型只涵蓋體驗用的示範資料，換成完整版字型即可，見 shared/assets/README.md）");
  }
  if (a["embed-docx"]) {
    if (!a.out) { console.error("--embed-docx 需要搭配 --out"); process.exit(2); }
    embedImageIntoDocx(a["embed-docx"], a.png, a.out);
    console.log(`已將家系圖嵌入 docx：${a.out}`);
  }
}
