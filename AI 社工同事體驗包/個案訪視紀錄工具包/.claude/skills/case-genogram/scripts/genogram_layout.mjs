/**
 * 家系圖的版面計算（對應 render_genogram.py 的 layout()）。
 * 純運算、沒有繪圖，方便單獨比對 Python 版的座標結果。
 *
 * 座標系沿用 Python 版：x 往右、y 往上（越上層世代 y 越大），單位是「格」。
 */
export const GEN_GAP = 2.2;
export const UNIT_GAP = 1.6;
export const COUPLE_GAP = 0.9;
export const SYMBOL_SIZE = 0.5;
export const LABEL_ZONE_TOP = 0.32;
export const LABEL_ZONE_BOTTOM = 0.95;
export const IP_SCALE = 1.3;

/** 伴侶狀態（互斥，最多擇一）：全黑實線，只靠斜線數量與三角形記號區分 */
export const STATUS_STYLE = {
  married: { slashes: 0 },
  cohabiting: { slashes: 0, triangle: true },
  separated: { slashes: 1 },
  divorced: { slashes: 2 },
};

/** 情感關係（可與伴侶狀態疊加）：靠線型／線數／鋸齒／截斷記號區分 */
export const QUALITY_STYLE = {
  close: { mode: "parallel", lines: 2 },
  enmeshed: { mode: "parallel", lines: 3 },
  distant: { mode: "parallel", lines: 1, linestyle: "dotted" },
  conflict: { mode: "zigzag" },
  conflictClose: { mode: "zigzag_double" },
  cutoff: { mode: "cutoff" },
};

export const memberHalfSize = (m) =>
  (SYMBOL_SIZE * (m.is_index ? IP_SCALE : 1)) / 2;

export function layout(members, relations) {
  const byId = Object.fromEntries(members.map((m) => [m.id, m]));
  const gens = {};
  for (const m of members) (gens[m.generation] ??= []).push(m);

  // 先把配偶／伴侶合併成 unit（單身自成一個），之後一律以 unit 整組移動，
  // 避免只搬其中一人而把伴侶拆散
  const unitsByGen = {}, unitOfMember = new Map();
  for (const [genKey, row] of Object.entries(gens)) {
    const gen = Number(genKey);
    const spouseOf = {};
    for (const r of relations) {
      if (!(r.type in STATUS_STYLE)) continue;
      const { a, b } = r;
      if (byId[a] && byId[b] && byId[a].generation === gen && byId[b].generation === gen) {
        spouseOf[a] = b; spouseOf[b] = a;
      }
    }
    const placed = new Set(), units = [];
    for (const m of row) {
      if (placed.has(m.id)) continue;
      const sp = spouseOf[m.id];
      if (sp && !placed.has(sp) && byId[sp]) {
        // 標準家系圖：男左女右
        const swap = byId[m.id].gender === "female" && byId[sp].gender === "male";
        units.push(swap ? [sp, m.id] : [m.id, sp]);
        placed.add(m.id); placed.add(sp);
      } else { units.push([m.id]); placed.add(m.id); }
    }
    unitsByGen[gen] = units;
    for (const u of units) for (const id of u) unitOfMember.set(id, u);
  }

  const xPos = {}, unitCenter = new Map();
  for (const gen of Object.keys(unitsByGen).map(Number).sort((a, b) => a - b)) {
    let cursor = 0;
    for (const unit of unitsByGen[gen]) {
      let center;
      if (unit.length === 2) {
        xPos[unit[0]] = cursor;
        xPos[unit[1]] = cursor + COUPLE_GAP;
        center = cursor + COUPLE_GAP / 2;
        cursor += COUPLE_GAP + UNIT_GAP;
      } else {
        xPos[unit[0]] = cursor;
        center = cursor;
        cursor += UNIT_GAP;
      }
      unitCenter.set(unit[0], center);
    }
  }

  // 子女 x = 父母平均值，多名子女依序左右展開；子女若本身也在某個 unit 裡，
  // 整個 unit 一起平移
  const parentsOf = {};
  for (const r of relations) if (r.type === "parent") (parentsOf[r.b] ??= []).push(r.a);

  const childrenByParentSet = new Map();
  for (const [child, parents] of Object.entries(parentsOf)) {
    const key = [...parents].sort().join("|");
    if (!childrenByParentSet.has(key)) childrenByParentSet.set(key, { parents, children: [] });
    childrenByParentSet.get(key).children.push(child);
  }

  const order = new Map(members.map((m, i) => [m.id, i]));
  for (const { parents, children } of childrenByParentSet.values()) {
    const xs = parents.filter((p) => p in xPos).map((p) => xPos[p]);
    if (!xs.length) continue;
    const center = xs.reduce((a, b) => a + b, 0) / xs.length;

    const seen = [];
    for (const cid of [...children].sort((a, b) => order.get(a) - order.get(b))) {
      const unit = unitOfMember.get(cid) ?? [cid];
      if (!seen.includes(unit)) seen.push(unit);
    }
    const n = seen.length;
    seen.forEach((unit, i) => {
      const target = center + (i - (n - 1) / 2) * UNIT_GAP;
      const old = unitCenter.get(unit[0]) ?? xPos[unit[0]];
      const delta = target - old;
      for (const id of unit) xPos[id] += delta;
      unitCenter.set(unit[0], target);
    });
  }

  for (const m of members) if (!(m.id in xPos)) xPos[m.id] = 0;

  const maxGen = Math.max(...members.map((m) => m.generation), 0);
  const yPos = Object.fromEntries(members.map((m) => [m.id, (maxGen - m.generation) * GEN_GAP]));
  return { xPos, yPos };
}
