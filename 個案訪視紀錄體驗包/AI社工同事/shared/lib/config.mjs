/**
 * 共用的設定讀取（對應原本的 load_config.py）。
 *
 * 路徑欄位的展開規則與 Python 版完全一致：
 *   ~ 開頭       → 展開成使用者家目錄
 *   絕對路徑      → 原樣使用
 *   其餘（相對）   → 以「工具包根目錄」（shared/ 的上一層）為基準
 *
 * 這樣整包不管被放在桌面、下載資料夾或任何位置，只要三個示範資料夾
 * 維持同一層的相對關係就能運作，不綁死固定路徑。
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, isAbsolute, normalize } from "node:path";
import { homedir } from "node:os";
import { isMain } from "./cli.mjs";

const LIB_DIR = dirname(fileURLToPath(import.meta.url));
export const SHARED_DIR = dirname(LIB_DIR);
export const TOOLKIT_ROOT = dirname(SHARED_DIR);
export const CONFIG_PATH = join(SHARED_DIR, "config.json");

/** 值是路徑的欄位；其餘（信箱、姓名、網址…）一律原樣傳回 */
const PATH_KEYS = new Set(["case_data_xlsx", "draft_dir", "raw_transcript_dir", "archive_dir"]);

export function resolvePath(v) {
  if (v.startsWith("~")) return join(homedir(), v.slice(1).replace(/^[/\\]/, ""));
  if (isAbsolute(v)) return v;
  return normalize(join(TOOLKIT_ROOT, v));
}

export function getConfig() {
  if (!existsSync(CONFIG_PATH)) return {};
  const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    out[k] = PATH_KEYS.has(k) && typeof v === "string" && v ? resolvePath(v) : v;
  }
  return out;
}

/** 字型與繪圖資產的位置（給家系圖用） */
export const FONT_PATH = join(SHARED_DIR, "assets", "NotoSansTC-subset.ttf");

if (isMain(import.meta.url)) {
  const cfg = getConfig();
  const key = process.argv[2];
  if (!Object.keys(cfg).length) console.log("尚未設定，請確認 shared/config.json 存在");
  else if (key) console.log(cfg[key] ?? "");
  else for (const [k, v] of Object.entries(cfg)) console.log(`${k}: ${v}`);
}
