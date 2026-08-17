#!/usr/bin/env python3
"""
這個體驗工具包已經預先幫你把 shared/config.json 填好demo用的設定
（個案資料表路徑、主管信箱、訪視人員姓名、系統網址、歸檔資料夾），
體驗時不需要跑這支腳本。

如果之後要接自己機構的真實資料（換掉 demo 資料），再跑這支腳本重新設定：

    python3 shared/scripts/setup_config.py

會用問答的方式更新 shared/config.json，之後所有 skill 都會自動讀這份設定。

路徑可以填相對路徑（例如 `../明怡服務紀錄資料夾/個案資料表.xlsx`，以這個工具包
根目錄為基準，好處是不管整包放在哪裡都能動），也可以填絕對路徑（例如正式導入時
指到公司共用磁碟的固定位置）。
"""
import json
import os

_SHARED_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG_PATH = os.path.join(_SHARED_DIR, "config.json")

QUESTIONS = [
    (
        "case_data_xlsx",
        "個案資料表 xlsx 的完整路徑（case-visit-record／case-genogram 用來查身分資料）",
        "../明怡服務紀錄資料夾/個案資料表-demo.xlsx",
    ),
    (
        "supervisor_email",
        "主管確認信要寄給誰（Email，case-visit-approval 用）",
        "",
    ),
    (
        "default_staff_name",
        "預設訪視人員姓名（沒有的話每次都要自己講，可留空）",
        "",
    ),
    (
        "external_system_url",
        "外部個案管理系統網址（case-external-record-entry 用；這是共用的系統，不要改）",
        "https://deploy-nine-blue-62.vercel.app",
    ),
    (
        "draft_dir",
        "核准前的訪視紀錄草稿要放在哪個資料夾",
        "../個人工作",
    ),
    (
        "raw_transcript_dir",
        "家訪逐字稿原始檔要放在哪個資料夾",
        "../個人工作/訪視原始資料",
    ),
    (
        "archive_dir",
        "訪視紀錄核准後要歸檔到哪個資料夾",
        "../明怡服務紀錄資料夾/已歸檔",
    ),
]


def load_existing():
    if os.path.exists(CONFIG_PATH):
        with open(CONFIG_PATH, encoding="utf-8") as f:
            return json.load(f)
    return {}


def main():
    existing = load_existing()
    print("設定個案訪視紀錄 skill 包的個人化資訊（直接按 Enter 使用預設值/沿用舊值）\n")

    config = {}
    for key, prompt, default in QUESTIONS:
        current = existing.get(key, default)
        shown_default = current if current else "（留空）"
        answer = input(f"{prompt}\n  [{shown_default}] > ").strip()
        config[key] = answer if answer else current

    os.makedirs(_SHARED_DIR, exist_ok=True)
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(config, f, ensure_ascii=False, indent=2)

    print(f"\n設定已存到：{CONFIG_PATH}")
    print("接下來所有 skill 執行時會自動讀這份設定。")


if __name__ == "__main__":
    main()
