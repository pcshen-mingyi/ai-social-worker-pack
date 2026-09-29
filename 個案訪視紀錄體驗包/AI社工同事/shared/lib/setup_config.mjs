#!/usr/bin/env node
/**
 * 這個體驗包已經預先把 shared/config.json 填好 demo 用的設定，
 * **體驗時不需要跑這支**。
 *
 * 之後要接自己機構的真實資料時再跑：
 *   node shared/lib/setup_config.mjs
 *
 * 會用問答方式更新 shared/config.json，之後所有 skill 都會自動讀這份設定。
 * 路徑可填相對路徑（以工具包根目錄為基準，整包搬到哪裡都能動）或絕對路徑。
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { CONFIG_PATH } from "./config.mjs";
import { isMain } from "./cli.mjs";

const QUESTIONS = [
  ["case_data_xlsx", "個案資料表 xlsx 的完整路徑（case-visit-record／case-genogram 用來查身分資料）", "../明怡服務紀錄資料夾/個案資料表-demo.xlsx"],
  ["supervisor_email", "主管確認信要寄給誰（Email，case-visit-approval 用）", ""],
  ["default_staff_name", "預設訪視人員姓名（沒有的話每次都要自己講，可留空）", ""],
  ["external_system_url", "外部個案管理系統網址（case-external-record-entry 用；這是共用的系統，不要改）", "https://deploy-nine-blue-62.vercel.app"],
  ["draft_dir", "核准前的訪視紀錄草稿要放在哪個資料夾", "../個人工作"],
  ["raw_transcript_dir", "家訪逐字稿原始檔要放在哪個資料夾", "../個人工作/訪視原始資料"],
  ["archive_dir", "訪視紀錄核准後要歸檔到哪個資料夾", "../明怡服務紀錄資料夾/已歸檔"],
];

if (isMain(import.meta.url)) {
  const existing = existsSync(CONFIG_PATH) ? JSON.parse(readFileSync(CONFIG_PATH, "utf8")) : {};
  console.log("設定個案訪視紀錄 skill 包的個人化資訊（直接按 Enter 使用預設值／沿用舊值）\n");

  /**
   * 互動時用 readline 逐題問；非互動（管線、重導向）時先把 stdin 整份讀完再逐行取用。
   *
   * 為什麼要分兩種：readline 配管線時，輸入的行會比逐題 await 更早抵達，
   * 沒人在聽的行就掉了——看起來像「答案沒被採用」。
   * 另外 stdin 結束後 rl.question 永遠不會 resolve，程式會靜靜卡住。
   */
  const interactive = stdin.isTTY;
  let ask;
  let rl = null;

  if (interactive) {
    rl = createInterface({ input: stdin, output: stdout });
    ask = async (text) =>
      Promise.race([
        rl.question(text),
        new Promise((resolve) => rl.once("close", () => resolve(""))),
      ]);
  } else {
    const chunks = [];
    for await (const c of stdin) chunks.push(c);
    const piped = Buffer.concat(chunks).toString("utf8").split("\n");
    let i = 0;
    ask = async (text) => { stdout.write(text); const v = piped[i++] ?? ""; stdout.write(v + "\n"); return v; };
  }

  const config = {};
  for (const [key, prompt, dflt] of QUESTIONS) {
    const current = existing[key] ?? dflt;
    const shown = current || "（留空）";
    const answer = (await ask(`${prompt}\n  [${shown}] > `)).trim();
    config[key] = answer || current;
  }
  rl?.close();

  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", "utf8");
  console.log(`\n設定已存到：${CONFIG_PATH}`);
  console.log("接下來所有 skill 執行時會自動讀這份設定。");
}
