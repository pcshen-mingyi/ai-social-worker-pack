/**
 * 極小的點陣化器：輪廓 → 像素 → PNG。零第三方相依（只用 Node 內建 zlib）。
 *
 * 為什麼自己寫：試過的純 JS 繪圖庫（pureimage）掃描線填色會漏掉**水平邊**
 * （y0 === y1 的邊），而中文字幾乎每個字都有水平筆畫，結果「王」會變「工」。
 * 這裡用兩個規則避開那一類錯誤：
 *   1. 水平邊完全不參與交點計算（它們對「某條掃描線穿過幾次」沒有貢獻）
 *   2. 交點判定用半開區間 lo <= y < hi，避免頂點被算兩次而讓環繞數錯亂
 *
 * 反鋸齒：垂直方向取 SUB 條子掃描線，水平方向用解析式覆蓋率（算到小數像素），
 * 不需要放大再縮小，記憶體與速度都可接受。
 */
import { deflateSync } from "node:zlib";

const SUB = 5; // 每個像素列的子掃描線數；越大越平滑

export function makeCanvas(w, h, bg = [255, 255, 255]) {
  const rgb = new Uint8Array(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    rgb[i * 3] = bg[0]; rgb[i * 3 + 1] = bg[1]; rgb[i * 3 + 2] = bg[2];
  }
  return { w, h, rgb };
}

/** 把 opentype.js 的路徑指令攤平成多邊形輪廓 */
export function flatten(commands) {
  const contours = [];
  let cur = null, lx = 0, ly = 0;
  const push = (x, y) => { cur.push({ x, y }); lx = x; ly = y; };
  const close = () => { if (cur && cur.length > 2) contours.push(cur); cur = null; };
  for (const c of commands) {
    if (c.type === "M") { close(); cur = []; push(c.x, c.y); }
    else if (c.type === "L") push(c.x, c.y);
    else if (c.type === "Q") {
      const n = segs(lx, ly, c.x, c.y);
      for (let i = 1; i <= n; i++) {
        const t = i / n, u = 1 - t;
        push(u * u * lx + 2 * u * t * c.x1 + t * t * c.x,
             u * u * ly + 2 * u * t * c.y1 + t * t * c.y);
      }
    } else if (c.type === "C") {
      const n = segs(lx, ly, c.x, c.y);
      const x0 = lx, y0 = ly;
      for (let i = 1; i <= n; i++) {
        const t = i / n, u = 1 - t;
        push(u*u*u*x0 + 3*u*u*t*c.x1 + 3*u*t*t*c.x2 + t*t*t*c.x,
             u*u*u*y0 + 3*u*u*t*c.y1 + 3*u*t*t*c.y2 + t*t*t*c.y);
      }
    } else if (c.type === "Z") close();
  }
  close();
  return contours;
}
const segs = (x0, y0, x1, y1) =>
  Math.max(3, Math.min(24, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 1.5)));

/** 用 nonzero 環繞規則把輪廓填成覆蓋率 */
function coverage(w, h, contours) {
  const cov = new Float32Array(w * h);
  const edges = [];
  let minY = Infinity, maxY = -Infinity;
  for (const c of contours) {
    for (let i = 0; i < c.length; i++) {
      const a = c[i], b = c[(i + 1) % c.length];
      if (a.y === b.y) continue; // 水平邊：這就是那個 bug 的來源，直接跳過
      edges.push({ x0: a.x, y0: a.y, x1: b.x, y1: b.y, dir: b.y > a.y ? 1 : -1 });
      minY = Math.min(minY, a.y, b.y); maxY = Math.max(maxY, a.y, b.y);
    }
  }
  if (!edges.length) return cov;
  const py0 = Math.max(0, Math.floor(minY)), py1 = Math.min(h - 1, Math.ceil(maxY));
  const xs = [];
  for (let py = py0; py <= py1; py++) {
    for (let s = 0; s < SUB; s++) {
      const sy = py + (s + 0.5) / SUB;
      xs.length = 0;
      for (const e of edges) {
        const lo = Math.min(e.y0, e.y1), hi = Math.max(e.y0, e.y1);
        if (sy < lo || sy >= hi) continue; // 半開區間，頂點不重複計算
        xs.push({ x: e.x0 + ((sy - e.y0) / (e.y1 - e.y0)) * (e.x1 - e.x0), dir: e.dir });
      }
      if (xs.length < 2) continue;
      xs.sort((a, b) => a.x - b.x);
      let wind = 0, start = 0;
      for (const p of xs) {
        const prev = wind;
        wind += p.dir;
        if (prev === 0 && wind !== 0) start = p.x;
        else if (prev !== 0 && wind === 0) addSpan(cov, w, py, start, p.x, 1 / SUB);
      }
    }
  }
  return cov;
}

function addSpan(cov, w, py, xa, xb, weight) {
  if (xb <= xa) return;
  const row = py * w;
  const ia = Math.floor(xa), ib = Math.floor(xb);
  if (ia === ib) { if (ia >= 0 && ia < w) cov[row + ia] += (xb - xa) * weight; return; }
  if (ia >= 0 && ia < w) cov[row + ia] += (ia + 1 - xa) * weight;
  for (let x = Math.max(0, ia + 1); x < Math.min(w, ib); x++) cov[row + x] += weight;
  if (ib >= 0 && ib < w) cov[row + ib] += (xb - ib) * weight;
}

/** 把輪廓以指定顏色合成到畫布 */
export function fill(cv, contours, color = [0, 0, 0]) {
  const cov = coverage(cv.w, cv.h, contours);
  for (let i = 0; i < cv.w * cv.h; i++) {
    const a = Math.min(1, cov[i]);
    if (a <= 0) continue;
    for (let k = 0; k < 3; k++) {
      cv.rgb[i * 3 + k] = Math.round(cv.rgb[i * 3 + k] * (1 - a) + color[k] * a);
    }
  }
}

// ── 幾何形狀：全部化為「填多邊形」，共用同一條正確的程式路徑 ──
const ring = (outer, inner) => [outer, inner.slice().reverse()];
export const rectOutline = (x, y, w, h, t) =>
  ring([{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}],
       [{x:x+t,y:y+t},{x:x+w-t,y:y+t},{x:x+w-t,y:y+h-t},{x:x+t,y:y+h-t}]);
const circlePts = (cx, cy, r, n = 96) =>
  Array.from({length:n}, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
  });
export const circleOutline = (cx, cy, r, t) => ring(circlePts(cx,cy,r), circlePts(cx,cy,r-t));
export function line(x0, y0, x1, y1, t) {
  const dx = x1-x0, dy = y1-y0, L = Math.hypot(dx,dy) || 1;
  const nx = (-dy/L)*(t/2), ny = (dx/L)*(t/2);
  return [[{x:x0+nx,y:y0+ny},{x:x1+nx,y:y1+ny},{x:x1-nx,y:y1-ny},{x:x0-nx,y:y0-ny}]];
}

/** 實心多邊形（三角形記號、身障半邊塗黑都用這個） */
export const polygon = (pts) => [pts];

/** 折線描邊：每段各自畫成一個四邊形，接縫用小圓角補起來 */
export function polyline(pts, t) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    out.push(...line(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y, t));
  }
  // 轉折處補上小圓點，避免銳角出現缺口
  for (let i = 1; i < pts.length - 1; i++) {
    out.push(...circlePolygon(pts[i].x, pts[i].y, t / 2));
  }
  return out;
}
const circlePolygon = (cx, cy, r, n = 12) => [
  Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
  }),
];

/** 虛線：切成一段一段的實線 */
export function dashedLine(x0, y0, x1, y1, t, dash = 6, gap = 5) {
  const L = Math.hypot(x1 - x0, y1 - y0);
  if (!L) return [];
  const ux = (x1 - x0) / L, uy = (y1 - y0) / L;
  const out = [];
  for (let d = 0; d < L; d += dash + gap) {
    const e = Math.min(d + dash, L);
    out.push(...line(x0 + ux * d, y0 + uy * d, x0 + ux * e, y0 + uy * e, t));
  }
  return out;
}

// ── PNG 編碼（只用內建 zlib）──
const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c; }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
export function encodePNG(cv) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(cv.w, 0); ihdr.writeUInt32BE(cv.h, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit, truecolor RGB
  const raw = Buffer.alloc(cv.h * (1 + cv.w * 3));
  for (let y = 0; y < cv.h; y++) {
    const o = y * (1 + cv.w * 3);
    raw[o] = 0; // filter: none
    Buffer.from(cv.rgb.buffer, y * cv.w * 3, cv.w * 3).copy(raw, o + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * 畫一行文字，回傳 { width, missing }。
 *
 * 缺字必須「看得出來」：子集字型只涵蓋體驗包已知的文字，遇到範圍外的字
 * （例如有人改成真實姓名），glyph 會是 .notdef——**預設行為是靜默消失**，
 * 「陳美玲」會變成「陳美」，看的人不會發現名字少一個字。
 * 所以這裡改成畫一個空心方框，並把缺的字回報給呼叫端去警告使用者。
 */
export function drawText(cv, font, text, x, y, size, color = [0, 0, 0]) {
  const missing = [];
  let cur = x;
  for (const ch of text) {
    const g = font.charToGlyph(ch);
    const adv = (g.advanceWidth / font.unitsPerEm) * size;
    if (g.index === 0 && ch.trim()) {
      missing.push(ch);
      const w = adv || size * 0.9, t = Math.max(1, size / 16);
      fill(cv, rectOutline(cur + t, y - size * 0.78, w - t * 2, size * 0.78, t), color);
    } else if (g.path && g.path.commands.length) {
      fill(cv, flatten(g.getPath(cur, y, size).commands), color);
    }
    cur += adv || size * 0.9;
  }
  return { width: cur - x, missing };
}
