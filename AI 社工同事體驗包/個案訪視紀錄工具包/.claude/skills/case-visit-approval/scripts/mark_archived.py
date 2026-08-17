#!/usr/bin/env python3
"""
主管核准後：幫 Gmail thread 貼上「已歸檔」標籤並從收件匣封存，
同時把本機的訪視紀錄 docx 以日期格式檔名搬到指定的歸檔資料夾。

檔名規則：{case_id}_訪視紀錄_{visit_date}.docx
  例如：CASE-001_訪視紀錄_20260804.docx

用法：
    python3 mark_archived.py \
        --thread-id <thread id> \
        --docx 輸出檔.docx \
        --archive-dir 已歸檔/ \
        --case-id CASE-001 \
        --visit-date 20260804
"""
import argparse
import os
import shutil
import sys

_PLUGIN_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
sys.path.insert(0, os.path.join(_PLUGIN_ROOT, "shared", "scripts"))
from google_auth import get_service  # noqa: E402

LABEL_NAME = "已歸檔"


def get_or_create_label(gmail, name):
    labels = gmail.users().labels().list(userId="me").execute().get("labels", [])
    for label in labels:
        if label["name"] == name:
            return label["id"]
    created = gmail.users().labels().create(
        userId="me",
        body={"name": name, "labelListVisibility": "labelShow", "messageListVisibility": "show"},
    ).execute()
    return created["id"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--thread-id", required=True)
    parser.add_argument("--docx", required=True)
    parser.add_argument("--archive-dir", required=True)
    parser.add_argument("--case-id",    default="", help="個案編號，用於組合檔名，例如 CASE-001")
    parser.add_argument("--visit-date", default="", help="訪視日期（YYYYMMDD），用於組合檔名，例如 20260804")
    args = parser.parse_args()

    gmail = get_service("gmail", "v1")
    label_id = get_or_create_label(gmail, LABEL_NAME)

    gmail.users().threads().modify(
        userId="me",
        id=args.thread_id,
        body={"addLabelIds": [label_id], "removeLabelIds": ["INBOX"]},
    ).execute()

    os.makedirs(args.archive_dir, exist_ok=True)

    if args.case_id and args.visit_date:
        filename = f"{args.case_id}_訪視紀錄_{args.visit_date}.docx"
    else:
        filename = os.path.basename(args.docx)

    dest = os.path.join(args.archive_dir, filename)
    shutil.move(args.docx, dest)

    # 清除 pending 狀態
    import json
    pending_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "references", "pending_approvals.json")
    if os.path.exists(pending_path):
        with open(pending_path, encoding="utf-8") as f:
            pending = json.load(f)
        pending = {k: v for k, v in pending.items() if v.get("thread_id") != args.thread_id}
        with open(pending_path, "w", encoding="utf-8") as f:
            json.dump(pending, f, ensure_ascii=False, indent=2)

    print(f"已在 Gmail 貼上「{LABEL_NAME}」標籤並封存。")
    print(f"docx 已搬到：{dest}")


if __name__ == "__main__":
    main()
