#!/usr/bin/env python3
"""
共用的設定讀取模組。給各個 skill 的腳本 import，取代各自硬寫路徑/信箱。

用法（在其他腳本裡）：
    import sys, os
    sys.path.insert(0, os.path.join(_PLUGIN_ROOT, "shared", "scripts"))
    from load_config import get_config

    cfg = get_config()
    data_path = cfg.get("case_data_xlsx")

找不到 shared/config.json 時會回傳空字典，並提醒要先跑 setup_config.py。

路徑欄位的展開規則：
- 以 `~` 開頭 → 展開成使用者家目錄（給進階/正式導入時指定固定路徑用）
- 絕對路徑（例如 macOS/Linux 的 `/...`、Windows 的 `C:\...`）→ 原樣使用
- 其餘（相對路徑，例如 `../明怡服務紀錄資料夾/個案資料表-demo.xlsx`）→
  以「這個工具包的根目錄」（也就是 shared/ 的上一層）為基準展開。
  這樣整個工具包不管被放在桌面、下載資料夾、還是隨便哪個位置，只要三個
  示範資料夾維持同一層的相對關係，體驗就能正常運作，不綁死在固定路徑上。
"""
import json
import os

_SHARED_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_TOOLKIT_ROOT = os.path.dirname(_SHARED_DIR)
CONFIG_PATH = os.path.join(_SHARED_DIR, "config.json")

# config.json 裡「值是路徑」的欄位；只有這些欄位會做路徑展開，
# 其餘欄位（信箱、姓名、網址…）一律原樣傳回。
_PATH_KEYS = {"case_data_xlsx", "draft_dir", "raw_transcript_dir", "archive_dir"}


def get_config():
    if not os.path.exists(CONFIG_PATH):
        return {}
    with open(CONFIG_PATH, encoding="utf-8") as f:
        raw = json.load(f)
    expanded = {}
    for k, v in raw.items():
        if k in _PATH_KEYS and isinstance(v, str) and v:
            expanded[k] = _resolve_path(v)
        else:
            expanded[k] = v
    return expanded


def _resolve_path(v):
    if v.startswith("~"):
        return os.path.expanduser(v)
    if os.path.isabs(v):
        return v
    return os.path.normpath(os.path.join(_TOOLKIT_ROOT, v))


if __name__ == "__main__":
    import sys

    cfg = get_config()
    if not cfg:
        print("尚未設定，請先執行：python3 shared/scripts/setup_config.py")
    elif len(sys.argv) > 1:
        # 只印單一欄位的值，方便 shell 指令直接取用，例如：
        #   python3 shared/scripts/load_config.py case_data_xlsx
        key = sys.argv[1]
        print(cfg.get(key, ""))
    else:
        for k, v in cfg.items():
            print(f"{k}: {v}")
