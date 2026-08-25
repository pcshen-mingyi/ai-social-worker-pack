/**
 * 判斷「這個檔案是被直接執行，還是被 import」。
 *
 * 不能拿 import.meta.url 直接跟 process.argv[1] 比字串：
 * import.meta.url 是 file:// URL，路徑裡的空白會變成 %20、中文會變成一長串
 * 百分號編碼，而 argv[1] 是原始檔案路徑——兩者永遠不相等。
 * 這個工具包的路徑同時有空白和中文，是最容易踩到的情況。
 *
 * 所以先把 URL 轉回檔案路徑，再用 realpath 正規化（處理符號連結與大小寫）。
 */
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";

export function isMain(importMetaUrl) {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(importMetaUrl)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

/** 讀命名參數：--data foo.json --png out.png */
export function args(argv = process.argv.slice(2)) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) out[key] = true;
      else { out[key] = next; i++; }
    } else out._.push(a);
  }
  return out;
}
