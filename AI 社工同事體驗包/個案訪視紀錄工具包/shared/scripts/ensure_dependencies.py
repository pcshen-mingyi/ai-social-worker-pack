#!/usr/bin/env python3
"""
自動檢查並安裝這個工具包需要的東西，使用者不需要自己動手。
在任何 skill 第一次執行前，Claude 應該先跑這支腳本一次（之後每次都很快，
已經裝好的東西會直接跳過）。

檢查項目：
- Python 套件（requirements.txt）：缺的就自動 pip install

不檢查 claude-in-chrome，那是 Claude Code 本身的連接器，不是這個工具包的責任。
"""
import importlib.util
import subprocess
import sys
import os

_SHARED_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REQUIREMENTS = os.path.join(_SHARED_DIR, "requirements.txt")

PACKAGE_TO_IMPORT = {
    "python-docx": "docx",
    "openpyxl": "openpyxl",
    "matplotlib": "matplotlib",
    "google-api-python-client": "googleapiclient",
    "google-auth": "google.auth",
    "google-auth-oauthlib": "google_auth_oauthlib",
    "google-auth-httplib2": "google_auth_httplib2",
}


def check_python_packages():
    missing = [pkg for pkg, mod in PACKAGE_TO_IMPORT.items()
               if importlib.util.find_spec(mod.split(".")[0]) is None]
    if not missing:
        print("[OK] Python 套件都已安裝")
        return
    print(f"[安裝中] 缺少 {len(missing)} 個 Python 套件：{', '.join(missing)}")
    subprocess.run([sys.executable, "-m", "pip", "install", "-r", REQUIREMENTS], check=True)
    print("[OK] Python 套件安裝完成")


if __name__ == "__main__":
    check_python_packages()
    print("\n[完成] 環境檢查結束，可以開始使用工具包。")
